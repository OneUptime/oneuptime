import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../../Models/AnalyticsModels/Log";
import Span from "../../../../Models/AnalyticsModels/Span";
import Service from "../../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  EXCEPTION_AI_EXPLANATION_VERSION,
  ExceptionAIExplanation,
  ExceptionExplanationCategory,
  ExceptionExplanationConfidence,
  ExceptionExplanationFrame,
  readExceptionAIExplanation,
} from "../../../../Types/Telemetry/ExceptionAIExplanation";
import { readChangeEventFields } from "../../../../Utils/Telemetry/ChangeEventFields";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import AIService, {
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Services/AIService";
import ChangeEventService from "../../../Services/ChangeEventService";
import ExceptionInstanceService from "../../../Services/ExceptionInstanceService";
import LogService from "../../../Services/LogService";
import ServiceService from "../../../Services/ServiceService";
import SpanService from "../../../Services/SpanService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import logger from "../../Logger";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../Telemetry/StackTraceParser";
import {
  sanitizeExceptionMessage,
  sanitizeStackTrace,
} from "../../Telemetry/ExceptionSanitizer";
import AiContextReader from "../AiContext/AiContextReader";
import { withAiContext } from "../AiContext/AiContextPrompt";

/*
 * EXPLAIN ONE EXCEPTION WITH ONEUPTIME AI.
 *
 * A person opening an exception wants three answers before anything else:
 * what happened, why, and what to change. OneUptime AI writes them from
 * what OneUptime already holds about the exception:
 *
 *   - the exception group: its type, message and stack trace, when it was
 *     first and last seen and in which releases, how often, whether it was
 *     handled, and whether it came back after it was resolved;
 *   - its latest occurrence, and the trace that occurrence happened in: the
 *     spans of the request around it, which failed, and how long they took;
 *   - the logs written in that trace;
 *   - the deploys of its service around the time it started.
 *
 * Everything is read as the person asking (their read scope over each
 * signal applies; a signal they may not read is simply left out), and
 * nothing is read twice: every source is best effort, so an explanation is
 * still written from the stack trace alone.
 *
 * What leaves the platform is bounded and scrubbed: each value is cut to a
 * fixed length FIRST - a message or stack trace can be megabytes on one line,
 * and the sanitizers below run regular expressions over it (AGENTS.md,
 * "Megabyte-long values") - then IDs, emails, IPs, tokens and secrets are
 * taken out (ExceptionSanitizer). The answer is JSON whose every field is
 * checked and bounded (readExceptionAIExplanation), and a suspect frame is
 * kept only when the stack trace holds its file.
 *
 * The call goes through AIService.executeWithLogging: the project's Enable AI
 * switch, its credits, daily limits, billing and the AI log are the ones every
 * OneUptime AI feature honours. The explanation is kept on the exception, so
 * the next person reads it without paying for it again.
 */

export const EXCEPTION_EXPLANATION_FEATURE: string = "ExceptionExplanation";

// How much of each value reaches the model, cut before anything else reads it.
export const MAX_PROMPT_MESSAGE_LENGTH: number = 2000;
export const MAX_PROMPT_STACK_TRACE_LENGTH: number = 6000;
export const MAX_PROMPT_LOG_LENGTH: number = 400;
export const MAX_PROMPT_SPAN_NAME_LENGTH: number = 200;
export const MAX_PROMPT_TITLE_LENGTH: number = 200;
export const MAX_PROMPT_SPANS: number = 40;
export const MAX_PROMPT_LOGS: number = 25;
export const MAX_PROMPT_CHANGES: number = 10;
export const MAX_PROMPT_IN_APP_FRAMES: number = 10;
// How long before the exception was first seen a deploy may have caused it.
export const CHANGE_LOOKBACK_MS: number = 3 * 24 * 60 * 60 * 1000;

/*
 * The span attributes that say what a request was doing without carrying
 * who made it: its route and method, the status it answered, the database
 * or queue it used. Nothing else from a span's attributes is sent.
 */
export const EXPLANATION_SPAN_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "http.route",
  "http.method",
  "http.request.method",
  "http.status_code",
  "http.response.status_code",
  "rpc.system",
  "rpc.method",
  "db.system",
  "db.operation",
  "db.operation.name",
  "messaging.system",
  "messaging.operation",
  "exception.code",
  "error.type",
];

export const EXCEPTION_EXPLANATION_SYSTEM_PROMPT: string = `You are OneUptime AI, explaining one application exception to the engineer who will fix it.

You are given the exception (its type, message and stack trace, with the frames of the application's own code listed separately), when it was first and last seen and in which releases, the trace its latest occurrence happened in, the logs written in that trace, and the deploys around the time it started. Values were scrubbed: placeholders such as <UUID>, <EMAIL> or <NUMBER> stand for the real values.

Answer with ONE JSON object and nothing else, with exactly these fields:
{
  "summary": "One or two plain sentences: what went wrong, for whom, and since when if the data says.",
  "rootCause": "Markdown, at most 120 words: the most likely root cause, citing the frame, span, log line or deploy that shows it. Say plainly when the evidence is thin.",
  "suggestedFix": "Markdown, at most 150 words: what to change, concretely. A short code snippet is welcome when the stack trace shows the code.",
  "confidence": "high" | "medium" | "low",
  "category": "code" | "dependency" | "infrastructure" | "user-input" | "configuration" | "unknown",
  "suspectFrames": [{"file": "path as written in the stack trace", "line": 42, "function": "name"}],
  "nextSteps": ["At most three short steps to confirm or fix it."]
}

Rules:
- suspectFrames: at most 3, copied from the stack trace, the application's own frames first. Never invent a file.
- Do not guess values that were scrubbed.
- If a deploy shortly before the exception first appeared is the likely cause, say which.
- If the exception came back after it was resolved, say what that suggests about the earlier fix.
- Do not wrap the JSON in prose.`;

export interface ExplanationSpan {
  name: string;
  kind: string;
  statusCode?: number | undefined;
  durationMs?: number | undefined;
  isExceptionSpan: boolean;
}

export interface ExplanationLog {
  time?: Date | undefined;
  severity: string;
  body: string;
}

export interface ExplanationChange {
  time: Date;
  eventType: string;
  title: string;
  version?: string | undefined;
  commitSha?: string | undefined;
}

export interface ExceptionExplanationEvidence {
  exceptionType: string;
  message: string;
  stackTrace: string;
  resourceName?: string | undefined;
  resourceType?: string | undefined;
  environment?: string | undefined;
  occurrenceCount: number;
  firstSeenAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  firstSeenInRelease?: string | undefined;
  lastSeenInRelease?: string | undefined;
  unhandled: boolean;
  errorClass?: string | undefined;
  isResolved: boolean;
  regressedAt?: Date | undefined;
  latestOccurrence?:
    | {
        time?: Date | undefined;
        release?: string | undefined;
        environment?: string | undefined;
        spanName?: string | undefined;
        spanAttributes: Dictionary<string>;
      }
    | undefined;
  spans: Array<ExplanationSpan>;
  logs: Array<ExplanationLog>;
  changes: Array<ExplanationChange>;
}

// Cut first, then scrub: a value can be megabytes long.
function scrubbedText(value: string | undefined, max: number): string {
  return sanitizeExceptionMessage((value || "").slice(0, max)).trim();
}

function isoTime(value: Date | undefined): string {
  if (!value) {
    return "unknown";
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString();
}

function framesOf(stackTrace: string): Array<StackFrame> {
  try {
    const parsed: ParsedStackTrace = StackTraceParser.parse(stackTrace);
    return parsed.frames;
  } catch {
    return [];
  }
}

/*
 * The user message: the evidence, section by section, every value cut and
 * scrubbed. Pure, so it can be read in a test without a model.
 */
export function buildExceptionExplanationPrompt(
  evidence: ExceptionExplanationEvidence,
): string {
  const stackTrace: string = sanitizeStackTrace(
    evidence.stackTrace.slice(0, MAX_PROMPT_STACK_TRACE_LENGTH),
  );

  const lines: Array<string> = [];

  lines.push("## Exception");
  lines.push(
    `Type: ${scrubbedText(evidence.exceptionType, MAX_PROMPT_TITLE_LENGTH) || "unknown"}`,
  );
  lines.push(
    `Message: ${scrubbedText(evidence.message, MAX_PROMPT_MESSAGE_LENGTH) || "(no message)"}`,
  );
  lines.push(
    `Where: ${scrubbedText(evidence.resourceName, MAX_PROMPT_TITLE_LENGTH) || "unknown resource"}${
      evidence.resourceType ? ` (${evidence.resourceType})` : ""
    }${evidence.environment ? `, environment ${scrubbedText(evidence.environment, MAX_PROMPT_TITLE_LENGTH)}` : ""}`,
  );
  lines.push(`Occurrences so far: ${evidence.occurrenceCount}`);
  lines.push(
    `First seen: ${isoTime(evidence.firstSeenAt)}${
      evidence.firstSeenInRelease
        ? ` in release ${scrubbedText(evidence.firstSeenInRelease, MAX_PROMPT_TITLE_LENGTH)}`
        : ""
    }`,
  );
  lines.push(
    `Last seen: ${isoTime(evidence.lastSeenAt)}${
      evidence.lastSeenInRelease
        ? ` in release ${scrubbedText(evidence.lastSeenInRelease, MAX_PROMPT_TITLE_LENGTH)}`
        : ""
    }`,
  );
  lines.push(
    `Handled by the application: ${evidence.unhandled ? "no (at least one occurrence escaped uncaught)" : "yes, or unknown"}`,
  );

  if (evidence.errorClass && evidence.errorClass !== "unknown") {
    lines.push(`Earlier triage classified it as: ${evidence.errorClass}`);
  }

  if (!evidence.isResolved && evidence.regressedAt) {
    lines.push(
      `It was resolved, and came back at ${isoTime(evidence.regressedAt)}: the earlier fix did not hold.`,
    );
  }

  const inAppFrames: Array<StackFrame> = framesOf(stackTrace)
    .filter((frame: StackFrame): boolean => {
      return frame.inApp;
    })
    .slice(0, MAX_PROMPT_IN_APP_FRAMES);

  lines.push("");
  lines.push("## Stack trace");
  lines.push(stackTrace || "(no stack trace was recorded)");

  if (inAppFrames.length > 0) {
    lines.push("");
    lines.push("## The application's own frames, innermost first");

    for (const frame of inAppFrames) {
      lines.push(
        `- ${frame.fileName}:${frame.lineNumber}${frame.functionName ? ` in ${frame.functionName}` : ""}`,
      );
    }
  }

  if (evidence.latestOccurrence) {
    const occurrence: ExceptionExplanationEvidence["latestOccurrence"] =
      evidence.latestOccurrence;

    lines.push("");
    lines.push("## Latest occurrence");
    lines.push(`Time: ${isoTime(occurrence.time)}`);

    if (occurrence.release) {
      lines.push(
        `Release: ${scrubbedText(occurrence.release, MAX_PROMPT_TITLE_LENGTH)}`,
      );
    }

    if (occurrence.spanName) {
      lines.push(
        `In span: ${scrubbedText(occurrence.spanName, MAX_PROMPT_SPAN_NAME_LENGTH)}`,
      );
    }

    for (const key of EXPLANATION_SPAN_ATTRIBUTE_KEYS) {
      const value: string | undefined = occurrence.spanAttributes[key];

      if (value) {
        lines.push(`${key}: ${scrubbedText(value, MAX_PROMPT_TITLE_LENGTH)}`);
      }
    }
  }

  if (evidence.spans.length > 0) {
    lines.push("");
    lines.push("## The trace of the latest occurrence, in order");

    for (const span of evidence.spans.slice(0, MAX_PROMPT_SPANS)) {
      const status: string =
        span.statusCode === 2 ? "error" : span.statusCode === 1 ? "ok" : "unset";
      const duration: string =
        span.durationMs !== undefined ? `, ${Math.round(span.durationMs)} ms` : "";

      lines.push(
        `- ${scrubbedText(span.name, MAX_PROMPT_SPAN_NAME_LENGTH) || "(unnamed)"} (${span.kind || "span"}, ${status}${duration})${
          span.isExceptionSpan ? " <- the exception was recorded here" : ""
        }`,
      );
    }
  }

  if (evidence.logs.length > 0) {
    lines.push("");
    lines.push("## Logs written in that trace");

    for (const log of evidence.logs.slice(0, MAX_PROMPT_LOGS)) {
      lines.push(
        `- ${isoTime(log.time)} ${log.severity || "Unspecified"}: ${scrubbedText(log.body, MAX_PROMPT_LOG_LENGTH)}`,
      );
    }
  }

  if (evidence.changes.length > 0) {
    lines.push("");
    lines.push("## Deploys and changes around the time it started");

    for (const change of evidence.changes.slice(0, MAX_PROMPT_CHANGES)) {
      lines.push(
        `- ${isoTime(change.time)} ${change.eventType || "change"}: ${scrubbedText(change.title, MAX_PROMPT_TITLE_LENGTH) || "(untitled)"}${
          change.version
            ? `, version ${scrubbedText(change.version, MAX_PROMPT_TITLE_LENGTH)}`
            : ""
        }${change.commitSha ? `, commit ${change.commitSha.slice(0, 12)}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

/*
 * The JSON object in a model's answer: the whole answer, the inside of a
 * fenced block, or the outermost braces. Found with indexOf, never a regular
 * expression over the answer.
 */
function extractJsonObject(content: string): unknown {
  const text: string = content.trim();
  const candidates: Array<string> = [text];

  const fenceStart: number = text.indexOf("```");

  if (fenceStart !== -1) {
    const bodyStart: number = text.indexOf("\n", fenceStart);
    const fenceEnd: number =
      bodyStart === -1 ? -1 : text.indexOf("```", bodyStart);

    if (bodyStart !== -1 && fenceEnd !== -1) {
      candidates.push(text.slice(bodyStart + 1, fenceEnd));
    }
  }

  const open: number = text.indexOf("{");
  const close: number = text.lastIndexOf("}");

  if (open !== -1 && close > open) {
    candidates.push(text.slice(open, close + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // The next candidate.
    }
  }

  return null;
}

/*
 * The explanation a model's answer holds, every field checked and bounded,
 * or null when it holds none. A suspect frame is kept only when the stack
 * trace holds its file, so a frame the model made up is never shown as one
 * of the exception's own.
 */
export function parseExceptionExplanationResponse(
  content: string,
  stackTrace: string,
): ExceptionAIExplanation | null {
  const explanation: ExceptionAIExplanation | null = readExceptionAIExplanation(
    extractJsonObject(content || ""),
  );

  if (!explanation) {
    return null;
  }

  return {
    ...explanation,
    version: EXCEPTION_AI_EXPLANATION_VERSION,
    suspectFrames: explanation.suspectFrames.filter(
      (frame: ExceptionExplanationFrame): boolean => {
        return Boolean(stackTrace) && stackTrace.includes(frame.file);
      },
    ),
  };
}

export interface ExceptionExplanationResult {
  explanation: ExceptionAIExplanation;
  generatedAt: Date;
}

export default class ExceptionExplainer {
  /*
   * Write OneUptime AI's explanation of an exception the caller may read,
   * keep it on the exception, and return it.
   */
  public static async explain(data: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ExceptionExplanationResult> {
    const exception: TelemetryException | null =
      await TelemetryExceptionService.findOneById({
        id: data.telemetryExceptionId,
        select: {
          _id: true,
          projectId: true,
          primaryEntityId: true,
          primaryEntityType: true,
          fingerprint: true,
          exceptionType: true,
          message: true,
          stackTrace: true,
          environment: true,
          occuranceCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
          firstSeenInRelease: true,
          lastSeenInRelease: true,
          unhandled: true,
          errorClass: true,
          isResolved: true,
          regressedAt: true,
        },
        props: data.props,
      });

    if (!exception || !exception.projectId) {
      throw new NotFoundException("Exception not found");
    }

    /*
     * The project's AI switch, before any evidence is read or a token is
     * spent (executeWithLogging refuses too; this refuses before the reads).
     */
    await AIService.assertProjectAIEnabled(exception.projectId);

    // One explanation at a time per exception: a double click writes one.
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.telemetryExceptionId.toString(),
        namespace: "ExceptionExplainer.explain",
        lockTimeout: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
      });
    } catch (err) {
      logger.debug(
        `Could not take the explanation lock for exception ${data.telemetryExceptionId.toString()}; writing it anyway: ${err}`,
      );
    }

    try {
      const evidence: ExceptionExplanationEvidence =
        await ExceptionExplainer.gatherEvidence(exception, data.props);

      const request: AILogRequest = {
        projectId: exception.projectId,
        feature: EXCEPTION_EXPLANATION_FEATURE,
        messages: [
          {
            role: "system",
            content: withAiContext(
              EXCEPTION_EXPLANATION_SYSTEM_PROMPT,
              await AiContextReader.read({ projectId: exception.projectId }),
            ),
          },
          { role: "user", content: buildExceptionExplanationPrompt(evidence) },
        ],
        maxTokens: 1800,
        temperature: 0.2,
        /*
         * The browser waits on this request: one attempt, bounded below the
         * proxy's budget (INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS).
         */
        requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
        requestRetries: 0,
        /*
         * The prompt holds telemetry whose read scope is narrower than the
         * AI log's readers': keep no previews of it.
         */
        storeContentPreviews: false,
      };

      if (data.props.userId) {
        request.userId = data.props.userId;
      }

      const response: AILogResponse =
        await AIService.executeWithLogging(request);

      const explanation: ExceptionAIExplanation | null =
        parseExceptionExplanationResponse(
          response.content,
          exception.stackTrace || "",
        );

      if (!explanation) {
        throw new BadDataException(
          "OneUptime AI did not return an explanation. Please try again.",
        );
      }

      const generatedAt: Date = OneUptimeDate.getCurrentDate();

      await TelemetryExceptionService.updateOneById({
        id: data.telemetryExceptionId,
        data: {
          aiExplanation: explanation,
          aiExplanationGeneratedAt: generatedAt,
        },
        props: { isRoot: true },
      });

      return { explanation, generatedAt };
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.debug(`Could not release the explanation lock: ${err}`);
        }
      }
    }
  }

  /*
   * What the explanation is written from, each source read as the caller and
   * best effort: one they may not read, or that fails, is left out.
   */
  public static async gatherEvidence(
    exception: TelemetryException,
    props: DatabaseCommonInteractionProps,
  ): Promise<ExceptionExplanationEvidence> {
    const projectId: ObjectID = exception.projectId!;

    const [latest, resourceName, changes] = await Promise.all([
      ExceptionExplainer.readLatestOccurrence(exception, props),
      ExceptionExplainer.readResourceName(exception, props),
      ExceptionExplainer.readChanges(exception, props),
    ]);

    const traceId: string = latest?.traceId?.toString() || "";

    const [spans, logs] = traceId
      ? await Promise.all([
          ExceptionExplainer.readSpans({
            projectId,
            traceId,
            exceptionSpanId: latest?.spanId?.toString() || "",
            props,
          }),
          ExceptionExplainer.readLogs({ projectId, traceId, props }),
        ])
      : [{ spans: [], exceptionSpanAttributes: {} }, []];

    return {
      exceptionType: exception.exceptionType || "",
      message: exception.message || "",
      stackTrace: exception.stackTrace || "",
      resourceName: resourceName || undefined,
      resourceType: exception.primaryEntityType || undefined,
      environment: exception.environment || undefined,
      occurrenceCount: exception.occuranceCount || 0,
      firstSeenAt: exception.firstSeenAt || undefined,
      lastSeenAt: exception.lastSeenAt || undefined,
      firstSeenInRelease: exception.firstSeenInRelease || undefined,
      lastSeenInRelease: exception.lastSeenInRelease || undefined,
      unhandled: Boolean(exception.unhandled),
      errorClass: exception.errorClass || undefined,
      isResolved: Boolean(exception.isResolved),
      regressedAt: exception.regressedAt || undefined,
      latestOccurrence: latest
        ? {
            time: latest.time || undefined,
            release: latest.release || undefined,
            environment: latest.environment || undefined,
            spanName: latest.spanName || undefined,
            spanAttributes: spans.exceptionSpanAttributes,
          }
        : undefined,
      spans: spans.spans,
      logs,
      changes,
    };
  }

  private static async readLatestOccurrence(
    exception: TelemetryException,
    props: DatabaseCommonInteractionProps,
  ): Promise<ExceptionInstance | null> {
    if (!exception.fingerprint) {
      return null;
    }

    try {
      const rows: Array<ExceptionInstance> =
        await ExceptionInstanceService.findBy({
          query: {
            projectId: exception.projectId!,
            fingerprint: exception.fingerprint,
            ...(exception.primaryEntityId
              ? { primaryEntityId: exception.primaryEntityId }
              : {}),
          },
          select: {
            time: true,
            traceId: true,
            spanId: true,
            spanName: true,
            release: true,
            environment: true,
          },
          sort: { time: SortOrder.Descending },
          limit: 1,
          skip: 0,
          props,
        });

      return rows[0] || null;
    } catch (err) {
      logger.debug(`Explanation: could not read the latest occurrence: ${err}`);
      return null;
    }
  }

  private static async readResourceName(
    exception: TelemetryException,
    props: DatabaseCommonInteractionProps,
  ): Promise<string | null> {
    if (
      !exception.primaryEntityId ||
      (exception.primaryEntityType &&
        exception.primaryEntityType !== ServiceType.OpenTelemetry)
    ) {
      return null;
    }

    try {
      const service: Service | null = await ServiceService.findOneById({
        id: exception.primaryEntityId,
        select: { name: true },
        props,
      });

      return service?.name?.toString() || null;
    } catch (err) {
      logger.debug(`Explanation: could not read the service: ${err}`);
      return null;
    }
  }

  private static async readSpans(data: {
    projectId: ObjectID;
    traceId: string;
    exceptionSpanId: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    spans: Array<ExplanationSpan>;
    exceptionSpanAttributes: Dictionary<string>;
  }> {
    try {
      const rows: Array<Span> = await SpanService.findBy({
        query: { projectId: data.projectId, traceId: data.traceId },
        select: {
          spanId: true,
          name: true,
          kind: true,
          statusCode: true,
          durationUnixNano: true,
          startTime: true,
        },
        sort: { startTime: SortOrder.Ascending },
        limit: MAX_PROMPT_SPANS,
        skip: 0,
        props: data.props,
      });

      let exceptionSpanAttributes: Dictionary<string> = {};

      if (data.exceptionSpanId) {
        const exceptionSpan: Span | null = await SpanService.findOneBy({
          query: {
            projectId: data.projectId,
            traceId: data.traceId,
            spanId: data.exceptionSpanId,
          },
          select: { attributes: true },
          props: data.props,
        });

        exceptionSpanAttributes = ExceptionExplainer.pickSpanAttributes(
          (exceptionSpan?.attributes as Dictionary<unknown>) || {},
        );
      }

      return {
        spans: rows.map((row: Span): ExplanationSpan => {
          const duration: number = Number(row.durationUnixNano);

          return {
            name: row.name || "",
            kind: row.kind ? String(row.kind) : "",
            statusCode:
              row.statusCode === undefined ? undefined : Number(row.statusCode),
            durationMs: Number.isFinite(duration)
              ? duration / 1_000_000
              : undefined,
            isExceptionSpan:
              Boolean(data.exceptionSpanId) &&
              row.spanId?.toString() === data.exceptionSpanId,
          };
        }),
        exceptionSpanAttributes,
      };
    } catch (err) {
      logger.debug(`Explanation: could not read the trace: ${err}`);
      return { spans: [], exceptionSpanAttributes: {} };
    }
  }

  // The allowed attributes only, each a short string.
  public static pickSpanAttributes(
    attributes: Dictionary<unknown>,
  ): Dictionary<string> {
    const picked: Dictionary<string> = {};

    for (const key of EXPLANATION_SPAN_ATTRIBUTE_KEYS) {
      const value: unknown = attributes[key];

      if (typeof value === "string" || typeof value === "number") {
        picked[key] = String(value).slice(0, MAX_PROMPT_TITLE_LENGTH);
      }
    }

    return picked;
  }

  private static async readLogs(data: {
    projectId: ObjectID;
    traceId: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ExplanationLog>> {
    try {
      const rows: Array<Log> = await LogService.findBy({
        query: { projectId: data.projectId, traceId: data.traceId },
        select: { time: true, severityText: true, body: true },
        sort: { time: SortOrder.Ascending },
        limit: MAX_PROMPT_LOGS,
        skip: 0,
        props: data.props,
      });

      return rows.map((row: Log): ExplanationLog => {
        return {
          time: row.time || undefined,
          severity: row.severityText ? String(row.severityText) : "",
          // Cut here already: a log body can be megabytes on one line.
          body: (typeof row.body === "string" ? row.body : "").slice(
            0,
            MAX_PROMPT_LOG_LENGTH,
          ),
        };
      });
    } catch (err) {
      logger.debug(`Explanation: could not read the logs: ${err}`);
      return [];
    }
  }

  private static async readChanges(
    exception: TelemetryException,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<ExplanationChange>> {
    const firstSeen: Date = exception.firstSeenAt
      ? new Date(exception.firstSeenAt)
      : OneUptimeDate.getCurrentDate();
    const now: Date = OneUptimeDate.getCurrentDate();

    try {
      const rows: Array<ChangeEvent> = await ChangeEventService.findBy({
        query: {
          projectId: exception.projectId!,
          time: new InBetween(
            new Date(firstSeen.getTime() - CHANGE_LOOKBACK_MS),
            now,
          ),
          ...(exception.primaryEntityId &&
          (!exception.primaryEntityType ||
            exception.primaryEntityType === ServiceType.OpenTelemetry)
            ? { primaryEntityId: exception.primaryEntityId }
            : {}),
        } as never,
        select: {
          time: true,
          eventType: true,
          title: true,
          attributes: true,
        } as never,
        sort: { time: SortOrder.Descending } as never,
        limit: MAX_PROMPT_CHANGES,
        skip: 0,
        props,
      });

      return rows
        .map((row: ChangeEvent): ExplanationChange => {
          const fields: ReturnType<typeof readChangeEventFields> =
            readChangeEventFields(
              (row.attributes as Dictionary<unknown>) || {},
            );

          return {
            time: new Date(row.time!),
            eventType: row.eventType ? String(row.eventType) : "",
            title: row.title ? String(row.title) : "",
            version: fields.version,
            commitSha: fields.commitSha,
          };
        })
        .sort((a: ExplanationChange, b: ExplanationChange): number => {
          return a.time.getTime() - b.time.getTime();
        });
    } catch (err) {
      logger.debug(`Explanation: could not read the changes: ${err}`);
      return [];
    }
  }
}

// Re-exported for the Dashboard's labels and the tests.
export { ExceptionExplanationCategory, ExceptionExplanationConfidence };
