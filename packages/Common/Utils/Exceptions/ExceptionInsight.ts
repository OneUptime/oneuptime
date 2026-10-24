import AIInsightSeverity from "../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../Types/AI/AIInsightType";
import {
  ExceptionInsightEvidence,
  ExceptionInsightFrameEvidence,
  ExceptionStackTraceGroupEvidence,
  ExceptionStackTraceInsightEvidence,
} from "../../Types/AI/AIInsightEvidence";
import CodeFixTaskType from "../../Types/AI/CodeFixTaskType";
import ErrorClass from "../../Types/Telemetry/ErrorClass";
import FeedMarkdown, { mdText, MarkdownText } from "../Markdown/FeedMarkdown";

/*
 * WHAT ONEUPTIME FINDS IN A PROJECT'S EXCEPTIONS, AND WHAT ITS PULL REQUEST
 * DOES - the Exceptions product's AI section (Types/AI/TelemetryAi). "Can
 * we do this for exception product as well? Improve exceptions / fix
 * exceptions automatically with PR's?" - the maintainer. Three kinds:
 *
 *   - New exception (NewException): an exception first seen in the last 24
 *     hours that already happened 3 or more times - a new way the code
 *     fails (Server/Utils/AI/SRE/Insights/Detectors/NewExceptionDetector);
 *
 *   - Rising exception (ExceptionSpike): an exception seen before that
 *     happened 10 or more times in the last hour, at 5 or more times its
 *     usual hourly rate (ExceptionSpikeDetector). These two were AI
 *     Insights' own findings before Exceptions had an AI section, and still
 *     are in a project whose Exceptions switch is off;
 *
 *   - Missing stack trace (ExceptionMissingStackTrace): a service whose
 *     exceptions over the last day were recorded with no stack trace at
 *     all - 20 or more times, together - so nobody can tell which of its
 *     code raised them, and OneUptime AI cannot fix them
 *     (ExceptionMissingStackTraceDetector).
 *
 * What the pull request does:
 *
 *   - for a new or rising exception, it waits for the investigation's
 *     verdict: a fault of the code is fixed (the exception's own "Fix with
 *     AI", CodeFixTaskType.FixException); an expected error - a user's bad
 *     input, an intentional denial the code lets escape as an exception -
 *     gets better handling (ImproveExceptionHandling: validate earlier,
 *     answer with a clear error, keep user data out of the message, record
 *     it as handled). Anything else gets no pull request on its own. And
 *     OneUptime AI opens one on its own only for an exception raised in
 *     the application's own code: one whose stack trace has a frame of it
 *     (getOwnCodeFrames) - one of library and runtime frames only, or none
 *     at all, says nothing about which code to change;
 *   - for missing stack traces, right away: a request in Code to make the
 *     service record a stack trace with every exception.
 *
 * Pure: the detectors, the fix, the Dashboard, the tests and the docs
 * suites read it alike.
 */

export enum ExceptionInsightKind {
  New = "New",
  Rising = "Rising",
  MissingStackTrace = "MissingStackTrace",
}

export const EXCEPTION_INSIGHT_TYPE_BY_KIND: Readonly<
  Record<ExceptionInsightKind, AIInsightType>
> = {
  [ExceptionInsightKind.New]: AIInsightType.NewException,
  [ExceptionInsightKind.Rising]: AIInsightType.ExceptionSpike,
  [ExceptionInsightKind.MissingStackTrace]:
    AIInsightType.ExceptionMissingStackTrace,
};

// The kind of an insight type, or null for one the Exceptions lane lacks.
export function getExceptionInsightKind(
  insightType: unknown,
): ExceptionInsightKind | null {
  for (const kind of Object.values(ExceptionInsightKind)) {
    if (EXCEPTION_INSIGHT_TYPE_BY_KIND[kind] === insightType) {
      return kind;
    }
  }

  return null;
}

// Whether an insight is about one exception: a new or a rising one.
export function isExceptionInsightAboutOneException(
  insightType: unknown,
): boolean {
  const kind: ExceptionInsightKind | null =
    getExceptionInsightKind(insightType);

  return (
    kind === ExceptionInsightKind.New || kind === ExceptionInsightKind.Rising
  );
}

/*
 * ---------------------------------------------------------------------------
 * Your own code in a stack trace.
 * ---------------------------------------------------------------------------
 */

// The frames of the application's own code a finding keeps.
export const EXCEPTION_INSIGHT_MAX_OWN_CODE_FRAMES: number = 3;

// The longest file name and function name a kept frame carries.
export const EXCEPTION_INSIGHT_FRAME_TEXT_MAX_LENGTH: number = 200;

/*
 * One frame as the server's stack trace parser reads it (Server/Utils/
 * Telemetry/StackTraceParser): inApp is false for a library's, a
 * framework's or the runtime's frame.
 */
export interface ExceptionStackFrameReading {
  functionName: string;
  fileName: string;
  lineNumber: number;
  inApp: boolean;
}

/*
 * Python writes its traceback with the most recent call last; every other
 * runtime the parser reads writes the innermost frame first.
 */
const PYTHON_TRACEBACK_HEADER: string = "Traceback (most recent call last)";

function cutText(text: string): string {
  const oneLine: string = (text || "").split("\n").join(" ").trim();

  return oneLine.length > EXCEPTION_INSIGHT_FRAME_TEXT_MAX_LENGTH
    ? `${oneLine.substring(0, EXCEPTION_INSIGHT_FRAME_TEXT_MAX_LENGTH - 1)}…`
    : oneLine;
}

/*
 * The frames of the application's own code in a stack trace, innermost
 * first, at most a few, each once: the place a pull request would change.
 * A frame needs a file to be found in a repository; one with none is not
 * kept, whatever the parser said of it.
 */
export function getOwnCodeFrames(data: {
  frames: ReadonlyArray<ExceptionStackFrameReading>;
  stackTrace: string;
}): Array<ExceptionInsightFrameEvidence> {
  const ordered: Array<ExceptionStackFrameReading> = (
    data.stackTrace || ""
  ).includes(PYTHON_TRACEBACK_HEADER)
    ? [...data.frames].reverse()
    : [...data.frames];

  const kept: Array<ExceptionInsightFrameEvidence> = [];
  const seen: Set<string> = new Set<string>();

  for (const frame of ordered) {
    const fileName: string = cutText(frame.fileName);

    if (!frame.inApp || !fileName) {
      continue;
    }

    const lineNumber: number =
      Number.isInteger(frame.lineNumber) && frame.lineNumber > 0
        ? frame.lineNumber
        : 0;
    const functionName: string = cutText(frame.functionName);
    const key: string = `${fileName}:${lineNumber}:${functionName}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    kept.push({ functionName, fileName, lineNumber });

    if (kept.length >= EXCEPTION_INSIGHT_MAX_OWN_CODE_FRAMES) {
      break;
    }
  }

  return kept;
}

/*
 * Whether a new or rising exception was raised in the application's own
 * code, by what its finding read: true or false once read, null for a
 * finding filed before it was (the fix reads the exception again).
 */
export function isExceptionRaisedInOwnCode(
  evidence: ExceptionInsightEvidence | null | undefined,
): boolean | null {
  if (!evidence || !Array.isArray(evidence.ownCodeFrames)) {
    return null;
  }

  return evidence.ownCodeFrames.length > 0;
}

// A frame as the evidence says it: "`getOrder` at `src/orders.ts:42`".
function describeFrame(frame: ExceptionInsightFrameEvidence): MarkdownText {
  const location: string = frame.lineNumber
    ? `${frame.fileName}:${frame.lineNumber}`
    : frame.fileName;

  return frame.functionName
    ? mdText`\`${frame.functionName}\` at \`${location}\``
    : mdText`\`${location}\``;
}

/*
 * What the evidence says about where the exception was raised: the frames
 * of your own code in its stack trace - or that it has none, or no stack
 * trace at all. Nothing for a finding filed before it was read.
 */
function describeOwnCode(data: {
  stackFrameCount?: number | undefined;
  ownCodeFrames?: Array<ExceptionInsightFrameEvidence> | undefined;
}): Array<MarkdownText> {
  if (!Array.isArray(data.ownCodeFrames)) {
    return [];
  }

  if (data.ownCodeFrames.length > 0) {
    return [
      FeedMarkdown.empty(),
      mdText`**Your code in its stack trace**`,
      FeedMarkdown.empty(),
      ...data.ownCodeFrames.map(
        (frame: ExceptionInsightFrameEvidence): MarkdownText => {
          return mdText`- ${describeFrame(frame)}`;
        },
      ),
    ];
  }

  return [
    data.stackFrameCount === 0
      ? mdText`- It was recorded without a stack trace, so no frame says which of your code raised it`
      : mdText`- Its stack trace shows only library and runtime code, so no frame says which of your code raised it`,
  ];
}

/*
 * ---------------------------------------------------------------------------
 * New and rising exceptions: their evidence, as the detectors write it.
 * ---------------------------------------------------------------------------
 */

function formatCount(count: number): string {
  return Math.round(Number.isFinite(count) ? count : 0).toLocaleString("en-US");
}

/*
 * A new exception's evidence, as a person reads it on its insight
 * (detailMarkdown): real numbers only. Pure, so NewExceptionDetector
 * writes it and the browser suite draws exactly what the detector wrote.
 * The message is the service's, written into Markdown escaped.
 */
export function buildNewExceptionDetail(data: {
  // The exception's type and message (ExceptionIdentity.buildExceptionLabel).
  label: string;
  // Sanitized (ExceptionSanitizer).
  message: string;
  serviceName: string | null;
  // ISO-8601, or nothing when it was not recorded.
  firstSeenAt: string | undefined;
  lookbackHours: number;
  totalOccurrenceCount: number;
  // The exception groups - stack variants - counted together.
  groupCount: number;
  stackFrameCount?: number | undefined;
  ownCodeFrames?: Array<ExceptionInsightFrameEvidence> | undefined;
}): string {
  const lines: Array<MarkdownText> = [
    mdText`**New exception detected**`,
    FeedMarkdown.empty(),
    mdText`- Exception: \`${data.label}\``,
  ];

  if (data.message) {
    lines.push(mdText`- Message: ${data.message}`);
  }

  if (data.serviceName) {
    lines.push(mdText`- Service: ${data.serviceName}`);
  }

  lines.push(
    mdText`- First seen: ${data.firstSeenAt || "unknown"} (within the last ${data.lookbackHours}h)`,
    mdText`- Occurrences so far: ${formatCount(data.totalOccurrenceCount)}`,
  );

  if (data.groupCount > 1) {
    lines.push(
      mdText`- Raised from ${formatCount(data.groupCount)} distinct stack traces (same exception type and message — counted together as one failure mode)`,
    );
  }

  lines.push(...describeOwnCode(data));

  return FeedMarkdown.join(lines, "\n").toString();
}

/*
 * A rising exception's evidence: the last hour against its usual hourly
 * rate. Pure, as the new exception's.
 */
export function buildExceptionSpikeDetail(data: {
  label: string;
  message: string;
  serviceName: string | null;
  // Zero occurrences in the whole baseline, then a burst.
  isDormantAwakening: boolean;
  recentWindowHours: number;
  recentOccurrenceCount: number;
  baselineWindowHours: number;
  baselineHourlyAverage: number;
  priorWindowCount: number;
  multiplier: number;
  firstSeenAt: string | undefined;
  totalOccurrenceCount: number;
  stackFrameCount?: number | undefined;
  ownCodeFrames?: Array<ExceptionInsightFrameEvidence> | undefined;
}): string {
  const lines: Array<MarkdownText> = [
    data.isDormantAwakening
      ? mdText`**Dormant exception woke up**`
      : mdText`**Exception spike detected**`,
    FeedMarkdown.empty(),
    mdText`- Exception: \`${data.label}\``,
  ];

  if (data.message) {
    lines.push(mdText`- Message: ${data.message}`);
  }

  if (data.serviceName) {
    lines.push(mdText`- Service: ${data.serviceName}`);
  }

  lines.push(
    mdText`- Occurrences in the last ${data.recentWindowHours}h: ${formatCount(data.recentOccurrenceCount)}`,
    mdText`- Baseline: ${data.baselineHourlyAverage.toFixed(2)}/hour over the prior ${data.baselineWindowHours}h (${formatCount(data.priorWindowCount)} total)`,
    mdText`- Spike multiplier: ${data.multiplier.toFixed(1)}x`,
    mdText`- Exception first seen: ${data.firstSeenAt || "unknown"} (lifetime occurrences: ${formatCount(data.totalOccurrenceCount)})`,
  );

  lines.push(...describeOwnCode(data));

  return FeedMarkdown.join(lines, "\n").toString();
}

/*
 * ---------------------------------------------------------------------------
 * What the pull request of a new or rising exception does.
 * ---------------------------------------------------------------------------
 */

export enum ExceptionFixKind {
  // A fault of the code: fix it.
  Fix = "Fix",
  // An expected error the code lets escape: handle it better.
  ImproveHandling = "ImproveHandling",
}

export const EXCEPTION_FIX_TASK_TYPE_BY_KIND: Readonly<
  Record<ExceptionFixKind, CodeFixTaskType>
> = {
  [ExceptionFixKind.Fix]: CodeFixTaskType.FixException,
  [ExceptionFixKind.ImproveHandling]: CodeFixTaskType.ImproveExceptionHandling,
};

/*
 * The investigation's verdicts that are an expected error: the user's bad
 * input, or an intentional check doing its job.
 */
export const EXCEPTION_EXPECTED_ERROR_CLASSIFICATIONS: ReadonlyArray<string> = [
  ErrorClass.UserError,
  ErrorClass.ExpectedDenial,
];

function isExpectedError(classification: unknown): boolean {
  return (
    typeof classification === "string" &&
    EXCEPTION_EXPECTED_ERROR_CLASSIFICATIONS.includes(classification)
  );
}

/*
 * The pull request OneUptime AI opens on its own for a new or rising
 * exception, by the investigation's verdict: a fix for a fault of the code,
 * better handling for an expected error, and none for anything else (the
 * environment, or a verdict it could not reach).
 */
export function getAutomaticExceptionFixKind(
  classification: unknown,
): ExceptionFixKind | null {
  if (classification === ErrorClass.CodeFault) {
    return ExceptionFixKind.Fix;
  }

  return isExpectedError(classification)
    ? ExceptionFixKind.ImproveHandling
    : null;
}

/*
 * The pull request a person asks for with Fix with AI: better handling for
 * an exception the investigation found to be an expected error, else a fix
 * - the person decides, whatever the verdict was, or before there is one.
 */
export function getPersonExceptionFixKind(
  classification: unknown,
): ExceptionFixKind {
  return isExpectedError(classification)
    ? ExceptionFixKind.ImproveHandling
    : ExceptionFixKind.Fix;
}

// The fix kind a Code recipe is, or null for one no exception fix uses.
export function getExceptionFixKindOfTaskType(
  taskType: unknown,
): ExceptionFixKind | null {
  for (const kind of Object.values(ExceptionFixKind)) {
    if (EXCEPTION_FIX_TASK_TYPE_BY_KIND[kind] === taskType) {
      return kind;
    }
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * Missing stack traces.
 * ---------------------------------------------------------------------------
 */

// The day each look reads: the exceptions last seen in it.
export const EXCEPTION_STACK_TRACE_WINDOW_HOURS: number = 24;

/*
 * The fewest times a service's exceptions without a stack trace happened,
 * together, before it is said to record them so: a handful is a one-off.
 */
export const EXCEPTION_STACK_TRACE_MIN_OCCURRENCES: number = 20;

// The services read on each look, the loudest first.
export const EXCEPTION_STACK_TRACE_MAX_SERVICES: number = 3;

// The exceptions without a stack trace one look reads, the loudest first.
export const EXCEPTION_STACK_TRACE_GROUP_SCAN_LIMIT: number = 200;

// The exceptions a finding names, the loudest first.
export const EXCEPTION_STACK_TRACE_GROUPS_KEPT: number = 5;

// A finding this loud is Medium; the rest Low: it costs visibility.
export const EXCEPTION_STACK_TRACE_MEDIUM_OCCURRENCES: number = 1000;

export const EXCEPTION_STACK_TRACE_FINGERPRINT_PREFIX: string =
  "exception-missing-stack-trace";

function readId(id: string): string {
  return (id || "").trim().toLowerCase();
}

// One finding per service: refreshed while it lasts, one pull request.
export function getExceptionStackTraceFingerprint(serviceId: string): string {
  return `${EXCEPTION_STACK_TRACE_FINGERPRINT_PREFIX}:${readId(serviceId)}`;
}

// Whether a finding's fingerprint is about this service.
export function isExceptionStackTraceFingerprintOfService(
  fingerprint: string,
  serviceId: string,
): boolean {
  const id: string = readId(serviceId);

  return (
    Boolean(id) &&
    (fingerprint || "").toLowerCase() ===
      `${EXCEPTION_STACK_TRACE_FINGERPRINT_PREFIX}:${id}`
  );
}

export interface ExceptionStackTraceWindow {
  startTime: Date;
  endTime: Date;
}

export function getExceptionStackTraceWindow(
  now: Date,
): ExceptionStackTraceWindow {
  return {
    startTime: new Date(
      now.getTime() - EXCEPTION_STACK_TRACE_WINDOW_HOURS * 60 * 60 * 1000,
    ),
    endTime: now,
  };
}

/*
 * One exception of the day with no stack trace, as the detector reads it:
 * its service, its words (sanitized) and how often it happened.
 */
export interface ExceptionStackTraceGroupReading {
  telemetryExceptionId: string;
  serviceId: string;
  exceptionType: string;
  exceptionMessage: string;
  occurrenceCount: number;
  // ISO-8601.
  lastSeenAt: string;
}

// A service the look picked, with its exceptions without a stack trace.
export interface ExceptionStackTraceServicePick {
  serviceId: string;
  // The loudest first, all of them.
  groups: Array<ExceptionStackTraceGroupReading>;
  occurrenceCount: number;
}

function byOccurrencesThenId(
  a: { occurrenceCount: number; id: string },
  b: { occurrenceCount: number; id: string },
): number {
  if (a.occurrenceCount !== b.occurrenceCount) {
    return b.occurrenceCount - a.occurrenceCount;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/*
 * The services whose exceptions without a stack trace happened often
 * enough, together, the loudest first - at most a few, each once. A
 * service is told apart by its id; an exception that names none is left
 * out (no rule, repository or person could act on it).
 */
export function pickServicesMissingStackTraces(
  readings: ReadonlyArray<ExceptionStackTraceGroupReading>,
): Array<ExceptionStackTraceServicePick> {
  const byService: Map<string, ExceptionStackTraceServicePick> = new Map<
    string,
    ExceptionStackTraceServicePick
  >();

  for (const reading of readings) {
    const serviceId: string = readId(reading.serviceId);

    if (!serviceId || !reading.telemetryExceptionId) {
      continue;
    }

    const count: number =
      Number.isFinite(reading.occurrenceCount) && reading.occurrenceCount > 0
        ? Math.floor(reading.occurrenceCount)
        : 0;
    const pick: ExceptionStackTraceServicePick = byService.get(serviceId) || {
      serviceId,
      groups: [],
      occurrenceCount: 0,
    };

    if (
      pick.groups.some((group: ExceptionStackTraceGroupReading): boolean => {
        return group.telemetryExceptionId === reading.telemetryExceptionId;
      })
    ) {
      continue;
    }

    pick.groups.push({ ...reading, serviceId, occurrenceCount: count });
    pick.occurrenceCount += count;
    byService.set(serviceId, pick);
  }

  return Array.from(byService.values())
    .filter((pick: ExceptionStackTraceServicePick): boolean => {
      return pick.occurrenceCount >= EXCEPTION_STACK_TRACE_MIN_OCCURRENCES;
    })
    .map(
      (
        pick: ExceptionStackTraceServicePick,
      ): ExceptionStackTraceServicePick => {
        return {
          ...pick,
          groups: [...pick.groups].sort(
            (
              a: ExceptionStackTraceGroupReading,
              b: ExceptionStackTraceGroupReading,
            ): number => {
              return byOccurrencesThenId(
                {
                  occurrenceCount: a.occurrenceCount,
                  id: a.telemetryExceptionId,
                },
                {
                  occurrenceCount: b.occurrenceCount,
                  id: b.telemetryExceptionId,
                },
              );
            },
          ),
        };
      },
    )
    .sort(
      (
        a: ExceptionStackTraceServicePick,
        b: ExceptionStackTraceServicePick,
      ): number => {
        return byOccurrencesThenId(
          { occurrenceCount: a.occurrenceCount, id: a.serviceId },
          { occurrenceCount: b.occurrenceCount, id: b.serviceId },
        );
      },
    )
    .slice(0, EXCEPTION_STACK_TRACE_MAX_SERVICES);
}

// A picked service's evidence, as the finding keeps it.
export function buildExceptionStackTraceEvidence(data: {
  pick: ExceptionStackTraceServicePick;
  window: ExceptionStackTraceWindow;
  withStackTraceCount: number;
}): ExceptionStackTraceInsightEvidence {
  return {
    serviceId: data.pick.serviceId,
    windowStartTime: data.window.startTime.toISOString(),
    windowEndTime: data.window.endTime.toISOString(),
    exceptions: data.pick.groups
      .slice(0, EXCEPTION_STACK_TRACE_GROUPS_KEPT)
      .map(
        (
          group: ExceptionStackTraceGroupReading,
        ): ExceptionStackTraceGroupEvidence => {
          return {
            telemetryExceptionId: group.telemetryExceptionId,
            exceptionType: group.exceptionType,
            exceptionMessage: group.exceptionMessage,
            occurrenceCount: group.occurrenceCount,
            lastSeenAt: group.lastSeenAt,
          };
        },
      ),
    exceptionCount: data.pick.groups.length,
    occurrenceCount: data.pick.occurrenceCount,
    withStackTraceCount:
      Number.isFinite(data.withStackTraceCount) && data.withStackTraceCount > 0
        ? Math.floor(data.withStackTraceCount)
        : 0,
  };
}

export function getExceptionStackTraceSeverity(
  evidence: ExceptionStackTraceInsightEvidence,
): AIInsightSeverity {
  return evidence.occurrenceCount >= EXCEPTION_STACK_TRACE_MEDIUM_OCCURRENCES
    ? AIInsightSeverity.Medium
    : AIInsightSeverity.Low;
}

// Whether none of the service's exceptions of the day carried a stack trace.
function isEveryException(
  evidence: ExceptionStackTraceInsightEvidence,
): boolean {
  return evidence.withStackTraceCount === 0;
}

// An exception as the finding names it: "TimeoutError: deadline exceeded".
export function describeStackTraceGroup(
  group: ExceptionStackTraceGroupEvidence,
): string {
  const parts: Array<string> = [group.exceptionType, group.exceptionMessage]
    .map((text: string): string => {
      return (text || "").trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });

  return parts.join(": ") || "An exception";
}

function times(count: number): string {
  return count === 1 ? "once" : `${formatCount(count)} times`;
}

// The insight's title: what was found, in a sentence.
export function getExceptionStackTraceTitle(data: {
  evidence: ExceptionStackTraceInsightEvidence;
  serviceName: string;
}): string {
  const service: string = data.serviceName || "A service";

  if (isEveryException(data.evidence)) {
    return `${service}'s exceptions have no stack trace`;
  }

  return data.evidence.exceptionCount === 1
    ? `An exception in ${service} has no stack trace`
    : `${formatCount(data.evidence.exceptionCount)} exceptions in ${service} have no stack trace`;
}

/*
 * What was found, in sentences: the opening of the request OneUptime
 * writes, and of the person's.
 */
export function describeExceptionStackTraceProblem(data: {
  evidence: ExceptionStackTraceInsightEvidence;
  serviceName: string;
}): string {
  const evidence: ExceptionStackTraceInsightEvidence = data.evidence;
  const service: string = data.serviceName || "The service";
  const loudest: string = evidence.exceptions
    .map((group: ExceptionStackTraceGroupEvidence): string => {
      return `${describeStackTraceGroup(group)} (${times(group.occurrenceCount)})`;
    })
    .join(", ");
  const opening: string = isEveryException(evidence)
    ? `Over the last day ${service} recorded its exceptions without a stack trace: ${formatCount(evidence.exceptionCount)} ${evidence.exceptionCount === 1 ? "exception" : "exceptions"}, ${times(evidence.occurrenceCount)}.`
    : `Over the last day ${service} recorded ${formatCount(evidence.exceptionCount)} of its exceptions without a stack trace, ${times(evidence.occurrenceCount)}, while ${formatCount(evidence.withStackTraceCount)} others carried one.`;

  return [
    opening,
    "Without one, nobody can tell which of its code raised them.",
    loudest ? `The loudest: ${loudest}.` : "",
  ]
    .filter((sentence: string): boolean => {
      return sentence.length > 0;
    })
    .join(" ");
}

/*
 * The evidence as a person reads it on the insight (its detailMarkdown):
 * real numbers only. Pure, so the detector writes it and the browser suite
 * draws exactly what the detector wrote. The exceptions' words are the
 * service's, written into Markdown escaped.
 */
export function buildExceptionStackTraceDetail(data: {
  serviceName: string;
  evidence: ExceptionStackTraceInsightEvidence;
}): MarkdownText {
  const evidence: ExceptionStackTraceInsightEvidence = data.evidence;
  const lines: Array<MarkdownText> = [
    mdText`**Missing stack traces in ${data.serviceName}**`,
    FeedMarkdown.empty(),
    mdText`- In the last day: ${formatCount(evidence.exceptionCount)} ${evidence.exceptionCount === 1 ? "exception" : "exceptions"} without a stack trace, ${times(evidence.occurrenceCount)}`,
    isEveryException(evidence)
      ? mdText`- None of its exceptions that day carried a stack trace`
      : mdText`- ${formatCount(evidence.withStackTraceCount)} of its other exceptions that day carried one`,
    mdText`- Without a stack trace, no frame says which of its code raised them`,
  ];

  if (evidence.exceptions.length > 0) {
    lines.push(
      FeedMarkdown.empty(),
      evidence.exceptionCount > evidence.exceptions.length
        ? mdText`**The loudest of them**`
        : mdText`**The exceptions**`,
      FeedMarkdown.empty(),
    );

    for (const group of evidence.exceptions) {
      lines.push(
        mdText`- \`${describeStackTraceGroup(group)}\` (${times(group.occurrenceCount)})`,
      );
    }
  }

  return FeedMarkdown.join(lines, "\n");
}

/*
 * The request's first line: what to do, and where - the task's title in
 * Code.
 */
export function getExceptionStackTraceRequestTitle(data: {
  serviceName: string;
}): string {
  return `Record a stack trace with ${data.serviceName || "this service"}'s exceptions`;
}

// What the AI is asked to do - and what it must not.
const STACK_TRACE_ASK: string =
  "Make the service record a stack trace with every exception it records: raise errors that carry one (an Error object rather than a string, or in Go an error wrapped with its stack), and record each exception where it is caught with the error itself, so its stack trace goes with it (in OpenTelemetry, recordException with the error, and in Go RecordError with trace.WithStackTrace(true)). Do not change what the code does, and record no secrets or personal data. If you find where one of these exceptions comes from, say so.";

// The leave OneUptime gives the AI on a task nobody waits on.
const STACK_TRACE_LEAVE: string =
  "If this service records its exceptions somewhere other than this repository, say where and change nothing.";

/*
 * What OneUptime asks the AI, for a finding: the title, what was found, and
 * what to do - said as OneUptime's own, with leave to change nothing, when
 * OneUptime starts the task itself (nobody waits on it to say otherwise).
 */
export function buildExceptionStackTraceRequestMessage(data: {
  evidence: ExceptionStackTraceInsightEvidence;
  serviceName: string;
  isStartedByOneUptime: boolean;
}): string {
  const problem: string = describeExceptionStackTraceProblem(data);

  return [
    getExceptionStackTraceRequestTitle(data),
    "",
    data.isStartedByOneUptime
      ? `OneUptime found this in the service's exceptions on its own. ${problem}`
      : problem,
    "",
    data.isStartedByOneUptime
      ? `${STACK_TRACE_ASK} ${STACK_TRACE_LEAVE}`
      : STACK_TRACE_ASK,
  ].join("\n");
}

/*
 * What the task is told OneUptime found, beside the exception it is given:
 * the deterministic evidence, in plain text.
 */
export function buildExceptionStackTraceEvidenceNote(
  evidence: ExceptionStackTraceInsightEvidence,
): string {
  const lines: Array<string> = [
    `Window: ${evidence.windowStartTime} to ${evidence.windowEndTime}`,
    `Exceptions without a stack trace: ${formatCount(evidence.exceptionCount)}, ${times(evidence.occurrenceCount)}`,
    `Exceptions of the service that day with a stack trace: ${formatCount(evidence.withStackTraceCount)}`,
  ];

  if (evidence.exceptions.length > 0) {
    lines.push("");

    for (const group of evidence.exceptions) {
      lines.push(
        `${describeStackTraceGroup(group)} (${times(group.occurrenceCount)}, last seen ${group.lastSeenAt})`,
      );
    }
  }

  return lines.join("\n");
}
