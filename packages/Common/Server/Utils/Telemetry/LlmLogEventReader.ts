import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import LogService from "../../Services/LogService";
import { DbJSONResponse, Results } from "../../Services/AnalyticsDatabaseService";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "./TelemetryReadScope";
import LlmSpanUtil from "./LlmSpan";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  LlmContentEventNames,
  LlmInferenceDetailsContentAttributeKeys,
  LlmInferenceDetailsEventName,
  LlmLogEventNameAttributeKey,
} from "../../../Types/Telemetry/LlmConventions";
import LlmLogEventsUtil, {
  LLM_LOG_EVENT_AFTER_CALL_MS,
  LLM_LOG_EVENT_BEFORE_CALL_MS,
  LlmLogEventCall,
  LlmLogEventRecord,
} from "../../../Utils/Telemetry/LlmLogEvents";
import {
  LLM_MESSAGE_MAX_JSON_LENGTH,
  LlmCallContent,
  LlmMessage,
  LlmMessagePart,
  LlmMessagePartType,
} from "../../../Utils/Telemetry/LlmMessageParser";

/*
 * THE GENAI LOG EVENTS OF SOME AI CALLS, READ FROM THE LOG TABLE.
 *
 * The OpenTelemetry instrumentations for JavaScript and Java, and Python's
 * with `true` or `event_only`, record no prompt or answer on the call's
 * span: they send them as GenAI events on the logs signal, each record
 * carrying the call's trace and span id (LlmLogEventsUtil reads them).
 *
 * Read when a conversation is opened, not copied onto the spans at ingest.
 * A call's span and its records arrive in separate exports, in either order
 * and seconds apart, and a span row is not rewritten once stored - a copy
 * would mean holding one signal back for the other, or a ClickHouse
 * mutation per call, and storing every prompt twice under two retentions.
 * Read here, a conversation costs one more query when it is opened, and only
 * when one of its answers lacks its prompt or its answer on the span.
 *
 * That query is bounded the way the Log table is laid out (sorted by
 * project and time, with bloom filters on traceId and spanId): one time
 * window per trace - from a minute before its first call to ten minutes
 * after its last, since a record that sends no time of its own (Python on a
 * newer SDK, the Java agent) is stored at the time it arrived - with that
 * trace's ids, windows that overlap merged. So a conversation that spans
 * days reads minutes of logs, not days. Only records named as GenAI content
 * events, or carrying the details event's attributes, come back; a body
 * longer than the parser reads comes back empty. The newest records are
 * kept when there are more than LLM_LOG_EVENT_MAX_RECORDS: a later call's
 * input repeats the history before it.
 *
 * Held to what the caller may read of LOGS (their log read scope, from the
 * route): the same rows the Logs page shows them. A read that times out
 * throws; the caller says it could not read them rather than "nothing".
 */

const LOG_TABLE: string = AnalyticsTableName.Log;

/*
 * Shorter than the span reads' 45 s: the log read follows the span read in
 * one request, and both must fit in nginx's 60 s.
 */
const READ_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 12,
  timeoutOverflowMode: "throw",
});

// The most records one read returns (the newest, when there are more).
export const LLM_LOG_EVENT_MAX_RECORDS: number = 20_000;

// The most time windows one read has; closer windows are merged past it.
export const LLM_LOG_EVENT_MAX_WINDOWS: number = 100;

// The records a conversation list row's title is looked for in, per trace.
export const LLM_LOG_EVENT_TITLE_RECORDS_PER_TRACE: number = 50;

// The column list every read selects, as LlmLogEventRecord reads it.
const RECORD_COLUMNS_SQL: string =
  `traceId, spanId, toString(timeUnixNano) AS timeUnixNano, ` +
  `toString(observedTimeUnixNano) AS observedTimeUnixNano, ` +
  `_part_offset AS rowOffset, attributes, ` +
  `if(length(body) > ${LLM_MESSAGE_MAX_JSON_LENGTH}, '', body) AS body`;

// A stretch of time, and the traces whose records are looked for in it.
export interface LlmLogEventWindow {
  startMs: number;
  endMs: number;
  traceIds: Array<string>;
}

export interface LlmLogEventReadResult {
  records: Array<LlmLogEventRecord>;
  // More records matched than were read (the oldest were left out).
  truncated: boolean;
}

// A conversation list row whose title the logs may hold.
export interface LlmLogEventTitleRequest {
  // What the answer is keyed by (the row's conversation key).
  key: string;
  // The trace of the conversation's first call, and when that call started.
  traceId: string;
  startedAtMs: number;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export default class LlmLogEventReader {
  /*
   * One window per trace, from LLM_LOG_EVENT_BEFORE_CALL_MS before its first
   * call to LLM_LOG_EVENT_AFTER_CALL_MS after its last; windows that overlap
   * are merged, and past `maxWindows` the two closest are merged until it
   * fits. Pure.
   */
  public static getWindows(
    calls: ReadonlyArray<LlmLogEventCall>,
    maxWindows: number = LLM_LOG_EVENT_MAX_WINDOWS,
  ): Array<LlmLogEventWindow> {
    const byTrace: Map<string, { startMs: number; endMs: number }> = new Map<
      string,
      { startMs: number; endMs: number }
    >();

    for (const call of calls) {
      const traceId: string = (call.traceId || "").toLowerCase();

      if (
        !traceId ||
        !Number.isFinite(call.startMs) ||
        !Number.isFinite(call.endMs)
      ) {
        continue;
      }

      const startMs: number = call.startMs - LLM_LOG_EVENT_BEFORE_CALL_MS;
      const endMs: number =
        Math.max(call.endMs, call.startMs) + LLM_LOG_EVENT_AFTER_CALL_MS;
      const existing: { startMs: number; endMs: number } | undefined =
        byTrace.get(traceId);

      byTrace.set(traceId, {
        startMs: existing ? Math.min(existing.startMs, startMs) : startMs,
        endMs: existing ? Math.max(existing.endMs, endMs) : endMs,
      });
    }

    const windows: Array<LlmLogEventWindow> = Array.from(byTrace.entries())
      .map(
        ([traceId, range]: [
          string,
          { startMs: number; endMs: number },
        ]): LlmLogEventWindow => {
          return {
            startMs: range.startMs,
            endMs: range.endMs,
            traceIds: [traceId],
          };
        },
      )
      .sort((left: LlmLogEventWindow, right: LlmLogEventWindow): number => {
        return left.startMs - right.startMs || left.endMs - right.endMs;
      });

    const merged: Array<LlmLogEventWindow> = [];

    for (const window of windows) {
      const last: LlmLogEventWindow | undefined = merged[merged.length - 1];

      if (last && window.startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, window.endMs);
        last.traceIds.push(...window.traceIds);
      } else {
        merged.push({ ...window, traceIds: [...window.traceIds] });
      }
    }

    const limit: number = Math.max(1, Math.trunc(maxWindows));

    while (merged.length > limit) {
      let closest: number = 0;
      let smallestGap: number = Number.POSITIVE_INFINITY;

      for (let index: number = 0; index + 1 < merged.length; index++) {
        const gap: number =
          merged[index + 1]!.startMs - merged[index]!.endMs;

        if (gap < smallestGap) {
          smallestGap = gap;
          closest = index;
        }
      }

      const left: LlmLogEventWindow = merged[closest]!;
      const right: LlmLogEventWindow = merged[closest + 1]!;

      merged.splice(closest, 2, {
        startMs: Math.min(left.startMs, right.startMs),
        endMs: Math.max(left.endMs, right.endMs),
        traceIds: [...left.traceIds, ...right.traceIds],
      });
    }

    return merged;
  }

  /*
   * The content records of the windows' traces: by span id when spanIds is
   * given (and the records that name no span, which assignToCalls places
   * by time), the newest first.
   */
  public static buildStatement(query: {
    projectId: ObjectID;
    windows: ReadonlyArray<LlmLogEventWindow>;
    logFilter: TelemetryServiceFilter;
    spanIds?: ReadonlyArray<string> | undefined;
    limit?: number | undefined;
  }): Statement {
    const statement: Statement = new Statement();

    statement.append(`SELECT ${RECORD_COLUMNS_SQL} FROM ${LOG_TABLE}`);
    LlmLogEventReader.appendWhere(statement, {
      projectId: query.projectId,
      windows: query.windows,
      logFilter: query.logFilter,
      eventNames: LlmContentEventNames,
    });

    if (query.spanIds && query.spanIds.length > 0) {
      statement.append(
        SQL` AND (spanId IN (${{
          type: TableColumnType.Text,
          value: new Includes(
            query.spanIds.map((spanId: string): string => {
              return spanId.toLowerCase();
            }),
          ),
        }}) OR spanId = '')`,
      );
    }

    statement.append(" ORDER BY time DESC");
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, (query.limit ?? LLM_LOG_EVENT_MAX_RECORDS) + 1),
      }}`,
    );
    statement.append(READ_SETTINGS);

    return statement;
  }

  /*
   * The first user messages of each trace (gen_ai.user.message records and
   * details records), oldest first, LLM_LOG_EVENT_TITLE_RECORDS_PER_TRACE
   * per trace: what a conversation list row's title is read from.
   */
  public static buildTitleStatement(query: {
    projectId: ObjectID;
    windows: ReadonlyArray<LlmLogEventWindow>;
    logFilter: TelemetryServiceFilter;
  }): Statement {
    const statement: Statement = new Statement();

    statement.append(`SELECT ${RECORD_COLUMNS_SQL} FROM ${LOG_TABLE}`);
    LlmLogEventReader.appendWhere(statement, {
      projectId: query.projectId,
      windows: query.windows,
      logFilter: query.logFilter,
      eventNames: ["gen_ai.user.message", LlmInferenceDetailsEventName],
    });
    statement.append(" ORDER BY time ASC");
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: LLM_LOG_EVENT_TITLE_RECORDS_PER_TRACE,
      }} BY traceId`,
    );
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: LLM_LOG_EVENT_MAX_RECORDS,
      }}`,
    );
    statement.append(READ_SETTINGS);

    return statement;
  }

  // A row of either read as the record LlmLogEventsUtil reads.
  public static toRecord(row: JSONObject): LlmLogEventRecord {
    return {
      traceId: isText(row["traceId"]) ? row["traceId"] : "",
      spanId: isText(row["spanId"]) ? row["spanId"] : "",
      timeUnixNano: row["timeUnixNano"] as string | number | undefined,
      observedTimeUnixNano: row["observedTimeUnixNano"] as
        | string
        | number
        | undefined,
      rowOffset: row["rowOffset"] as string | number | undefined,
      attributes:
        row["attributes"] && typeof row["attributes"] === "object"
          ? row["attributes"]
          : {},
      body: typeof row["body"] === "string" ? row["body"] : "",
    };
  }

  /*
   * The content records of these calls, oldest first. Throws when the read
   * fails (a timeout): "could not read" is not "nothing there".
   */
  public static async readForCalls(data: {
    projectId: ObjectID;
    calls: ReadonlyArray<LlmLogEventCall>;
    logFilter: TelemetryServiceFilter;
  }): Promise<LlmLogEventReadResult> {
    const windows: Array<LlmLogEventWindow> = LlmLogEventReader.getWindows(
      data.calls,
    );

    if (windows.length === 0) {
      return { records: [], truncated: false };
    }

    const rows: Array<JSONObject> = await LlmLogEventReader.readRows(
      LlmLogEventReader.buildStatement({
        projectId: data.projectId,
        windows: windows,
        logFilter: data.logFilter,
        spanIds: data.calls
          .map((call: LlmLogEventCall): string => {
            return call.spanId;
          })
          .filter(isText),
      }),
    );

    const truncated: boolean = rows.length > LLM_LOG_EVENT_MAX_RECORDS;

    return {
      records: LlmLogEventsUtil.sortRecords(
        rows
          .slice(0, LLM_LOG_EVENT_MAX_RECORDS)
          .map((row: JSONObject): LlmLogEventRecord => {
            return LlmLogEventReader.toRecord(row);
          }),
      ),
      truncated: truncated,
    };
  }

  /*
   * Titles for conversation list rows whose calls recorded no prompt on
   * their spans: the newest message the person sent in the conversation's
   * first call that has one in its log events, as the span's preview would
   * read (LlmSpanUtil.toPreview). Rows with none are left out. Throws when
   * the read fails.
   */
  public static async readTitles(data: {
    projectId: ObjectID;
    requests: ReadonlyArray<LlmLogEventTitleRequest>;
    logFilter: TelemetryServiceFilter;
  }): Promise<Map<string, string>> {
    const titles: Map<string, string> = new Map<string, string>();
    const requests: Array<LlmLogEventTitleRequest> = data.requests.filter(
      (request: LlmLogEventTitleRequest): boolean => {
        return isText(request.traceId) && Number.isFinite(request.startedAtMs);
      },
    );

    if (requests.length === 0) {
      return titles;
    }

    const windows: Array<LlmLogEventWindow> = LlmLogEventReader.getWindows(
      requests.map((request: LlmLogEventTitleRequest): LlmLogEventCall => {
        return {
          spanId: "",
          traceId: request.traceId,
          startMs: request.startedAtMs,
          endMs: request.startedAtMs,
          isModelCall: true,
        };
      }),
    );

    const rows: Array<JSONObject> = await LlmLogEventReader.readRows(
      LlmLogEventReader.buildTitleStatement({
        projectId: data.projectId,
        windows: windows,
        logFilter: data.logFilter,
      }),
    );

    const recordsByTrace: Map<string, Array<LlmLogEventRecord>> = new Map<
      string,
      Array<LlmLogEventRecord>
    >();

    for (const row of rows) {
      const record: LlmLogEventRecord = LlmLogEventReader.toRecord(row);
      const traceId: string = (record.traceId || "").toLowerCase();
      const traceRecords: Array<LlmLogEventRecord> =
        recordsByTrace.get(traceId) || [];

      traceRecords.push(record);
      recordsByTrace.set(traceId, traceRecords);
    }

    for (const request of requests) {
      const title: string = LlmLogEventReader.getTitle(
        recordsByTrace.get(request.traceId.toLowerCase()) || [],
      );

      if (title) {
        titles.set(request.key, title);
      }
    }

    return titles;
  }

  /*
   * What a trace's first call that recorded the person's words asked: its
   * records are grouped by span, oldest first, and the first span whose
   * input has a user message with text gives its newest one. Pure.
   */
  public static getTitle(records: ReadonlyArray<LlmLogEventRecord>): string {
    const bySpan: Map<string, Array<LlmLogEventRecord>> = new Map<
      string,
      Array<LlmLogEventRecord>
    >();

    for (const record of LlmLogEventsUtil.sortRecords(records)) {
      const spanId: string = (record.spanId || "").toLowerCase();
      const spanRecords: Array<LlmLogEventRecord> = bySpan.get(spanId) || [];

      spanRecords.push(record);
      bySpan.set(spanId, spanRecords);
    }

    for (const spanRecords of bySpan.values()) {
      const content: LlmCallContent =
        LlmLogEventsUtil.readContent(spanRecords);

      for (let index: number = content.input.length - 1; index >= 0; index--) {
        const message: LlmMessage = content.input[index]!;

        if (message.role !== "user") {
          continue;
        }

        const preview: string = LlmSpanUtil.toPreview(
          message.parts
            .filter((part: LlmMessagePart): boolean => {
              return part.type === LlmMessagePartType.Text;
            })
            .map((part: LlmMessagePart): string => {
              return part.text;
            })
            .join(" "),
        );

        if (preview) {
          return preview;
        }
      }
    }

    return "";
  }

  /*
   * The WHERE both reads share: the project, rows within retention, the
   * windows' traces, the content events (by name, or a details record
   * without one by its attributes) and the caller's log scope.
   */
  private static appendWhere(
    statement: Statement,
    data: {
      projectId: ObjectID;
      windows: ReadonlyArray<LlmLogEventWindow>;
      logFilter: TelemetryServiceFilter;
      eventNames: ReadonlyArray<string>;
    },
  ): void {
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND retentionDate >= now() AND (`,
    );

    data.windows.forEach((window: LlmLogEventWindow, index: number) => {
      if (index > 0) {
        statement.append(" OR ");
      }

      statement.append(
        SQL`(time >= ${{
          type: TableColumnType.DateTime64,
          value: new Date(window.startMs),
        }} AND time <= ${{
          type: TableColumnType.DateTime64,
          value: new Date(window.endMs),
        }} AND traceId IN (${{
          type: TableColumnType.Text,
          value: new Includes(window.traceIds),
        }}))`,
      );
    });

    statement.append(
      SQL`) AND (attributes[${{
        type: TableColumnType.Text,
        value: LlmLogEventNameAttributeKey,
      }}] IN (${{
        type: TableColumnType.Text,
        value: new Includes([...data.eventNames]),
      }}) OR (attributes[${{
        type: TableColumnType.Text,
        value: LlmLogEventNameAttributeKey,
      }}] = '' AND hasAny(attributeKeys, ${{
        type: TableColumnType.ArrayText,
        value: LlmInferenceDetailsContentAttributeKeys,
      }})))`,
    );

    TelemetryReadScopeUtil.appendServiceFilter(statement, data.logFilter);
  }

  private static async readRows(
    statement: Statement,
  ): Promise<Array<JSONObject>> {
    const result: Results = await LogService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []) as Array<JSONObject>;
  }
}
