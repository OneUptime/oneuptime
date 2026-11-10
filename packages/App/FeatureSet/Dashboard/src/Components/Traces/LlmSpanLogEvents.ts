import Log from "Common/Models/AnalyticsModels/Log";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import LlmLogEventsUtil, {
  LLM_LOG_EVENT_AFTER_CALL_MS,
  LLM_LOG_EVENT_BEFORE_CALL_MS,
  LlmLogEventRecord,
} from "Common/Utils/Telemetry/LlmLogEvents";
import LlmMessageParser, {
  LlmCallContent,
  LlmMessage as ParsedLlmMessage,
} from "Common/Utils/Telemetry/LlmMessageParser";
import { LlmMessage } from "../../Utils/LlmSpanDisplay";

/*
 * WHAT ONE AI CALL SENT AS GENAI LOG EVENTS, FOR ITS SPAN PANEL.
 *
 * The OpenTelemetry instrumentations for JavaScript and Java, and Python's
 * with `true` or `event_only`, record no prompt or answer on the call's
 * span: they send them as log records carrying the call's trace and span
 * id. When the span's own attributes and events hold no prompt (or no
 * answer), the panel reads the span's log records through the Log model -
 * so the reader's own log permissions apply, as on the Logs page - and
 * LlmLogEventsUtil reads them exactly as the conversation view does.
 *
 * A record that names no span is matched in conversations only, where the
 * trace's other calls are known.
 */

// The most log records of one span read for its prompt and answer.
export const LLM_SPAN_LOG_EVENT_LIMIT: number = 500;

export type LlmSpanLogEventsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; content: LlmCallContent }
  | { kind: "notAllowed" }
  | { kind: "failed" };

// What the panel shows, with which half came from the log events.
export interface LlmSpanMessages {
  promptMessages: Array<LlmMessage>;
  completionMessages: Array<LlmMessage>;
  // Whether any of the messages above were read from log events.
  fromLogEvents: boolean;
}

// A nanosecond count from a span field, as milliseconds; null when unknown.
export function nanosToMs(value: unknown): number | null {
  const parsed: number = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed / 1_000_000);
}

// The log list query for one span's records, around the call's time.
export function buildSpanLogEventsQuery(data: {
  projectId: ObjectID | null;
  traceId: string;
  spanId: string;
  startMs: number;
  endMs: number;
}): Query<Log> {
  return {
    ...(data.projectId ? { projectId: data.projectId } : {}),
    traceId: data.traceId,
    spanId: data.spanId,
    time: new InBetween<Date>(
      new Date(data.startMs - LLM_LOG_EVENT_BEFORE_CALL_MS),
      new Date(
        Math.max(data.endMs, data.startMs) + LLM_LOG_EVENT_AFTER_CALL_MS,
      ),
    ),
  } as Query<Log>;
}

// Whether a failed read was the reader not being allowed to read logs.
export function isNotAllowedError(error: unknown): boolean {
  if (!(error instanceof HTTPErrorResponse)) {
    return false;
  }

  return (
    error.statusCode === 401 ||
    error.statusCode === 403 ||
    error.statusCode === ExceptionCode.NotAuthorizedException
  );
}

export function toLogEventRecord(log: Log): LlmLogEventRecord {
  return {
    traceId: log.traceId || "",
    spanId: log.spanId || "",
    timeUnixNano: log.timeUnixNano,
    observedTimeUnixNano: log.observedTimeUnixNano,
    attributes: (log.attributes as JSONObject | undefined) || {},
    body: log.body || "",
  };
}

// What a span's records say, as the conversation view reads them.
export function readSpanLogEventContent(
  records: Array<LlmLogEventRecord>,
): LlmCallContent {
  return LlmLogEventsUtil.readContent(
    records.filter((record: LlmLogEventRecord): boolean => {
      return LlmLogEventsUtil.isContentEvent(record);
    }),
  );
}

function toPanelMessages(messages: Array<ParsedLlmMessage>): Array<LlmMessage> {
  return messages.map((message: ParsedLlmMessage): LlmMessage => {
    return {
      role: message.role,
      content: LlmMessageParser.toDisplayText(message),
    };
  });
}

/*
 * The panel's prompt and completion: the span's own where it has them, the
 * log events' where it does not - each half shown once. Instructions sent
 * apart from the history lead the prompt, as a system message would.
 */
export function mergeSpanMessages(data: {
  spanPrompt: Array<LlmMessage>;
  spanCompletion: Array<LlmMessage>;
  logContent: LlmCallContent | null;
}): LlmSpanMessages {
  const logs: LlmCallContent | null = data.logContent;

  let promptMessages: Array<LlmMessage> = data.spanPrompt;
  let completionMessages: Array<LlmMessage> = data.spanCompletion;
  let fromLogEvents: boolean = false;

  if (logs && promptMessages.length === 0) {
    const input: Array<LlmMessage> = toPanelMessages(logs.input);
    const hasSystem: boolean = input.some((message: LlmMessage): boolean => {
      return message.role === "system";
    });

    if (logs.systemInstructions && !hasSystem) {
      input.unshift({ role: "system", content: logs.systemInstructions });
    }

    if (input.length > 0) {
      promptMessages = input;
      fromLogEvents = true;
    }
  }

  if (logs && completionMessages.length === 0 && logs.output.length > 0) {
    completionMessages = toPanelMessages(logs.output);
    fromLogEvents = true;
  }

  return {
    promptMessages: promptMessages,
    completionMessages: completionMessages,
    fromLogEvents: fromLogEvents,
  };
}

// Reads one span's GenAI log events. Throws as the Log list read does.
export async function fetchSpanLogEventContent(data: {
  traceId: string;
  spanId: string;
  startMs: number;
  endMs: number;
}): Promise<LlmCallContent> {
  const result: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({
    modelType: Log,
    query: buildSpanLogEventsQuery({
      projectId: ProjectUtil.getCurrentProjectId(),
      traceId: data.traceId,
      spanId: data.spanId,
      startMs: data.startMs,
      endMs: data.endMs,
    }),
    select: {
      time: true,
      timeUnixNano: true,
      observedTimeUnixNano: true,
      attributes: true,
      body: true,
      spanId: true,
      traceId: true,
    } as Select<Log>,
    sort: { time: SortOrder.Ascending } as Record<string, SortOrder>,
    limit: LLM_SPAN_LOG_EVENT_LIMIT,
    skip: 0,
    requestOptions: {},
  });

  return readSpanLogEventContent(result.data.map(toLogEventRecord));
}
