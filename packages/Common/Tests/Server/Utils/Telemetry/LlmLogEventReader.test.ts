import { afterEach, describe, expect, jest, test } from "@jest/globals";
import LlmLogEventReader, {
  LLM_LOG_EVENT_MAX_RECORDS,
  LLM_LOG_EVENT_MAX_WINDOWS,
  LLM_LOG_EVENT_TITLE_RECORDS_PER_TRACE,
  LlmLogEventReadResult,
  LlmLogEventWindow,
} from "../../../../Server/Utils/Telemetry/LlmLogEventReader";
import LogService from "../../../../Server/Services/LogService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import {
  LlmContentEventNames,
  LlmInferenceDetailsContentAttributeKeys,
  LlmInferenceDetailsEventName,
  LlmLogEventNameAttributeKey,
} from "../../../../Types/Telemetry/LlmConventions";
import {
  LLM_LOG_EVENT_AFTER_CALL_MS,
  LLM_LOG_EVENT_BEFORE_CALL_MS,
  LlmLogEventCall,
  LlmLogEventRecord,
} from "../../../../Utils/Telemetry/LlmLogEvents";
import { LLM_MESSAGE_MAX_JSON_LENGTH } from "../../../../Utils/Telemetry/LlmMessageParser";
import { LLM_USER_MESSAGE_PREVIEW_LENGTH } from "../../../../Server/Utils/Telemetry/LlmSpan";
import {
  GenAiLogEventFixture,
  StoredGenAiSpan,
  loadGenAiLogEventFixture,
  toStoredLogRecords,
  toStoredSpans,
} from "../../../Helpers/GenAiLogEventFixtures";

/*
 * The read of a conversation's GenAI log events from the Log table
 * (LlmLogEventReader), without a server: the time windows it reads, the SQL
 * it sends, and what it makes of the rows. LlmLogEventsClickhouse runs the
 * same statements against a real ClickHouse.
 */

const PROJECT: ObjectID = new ObjectID("9900000000000000000000a1");
const SERVICE_A: ObjectID = new ObjectID("9900000000000000000000b1");
const SERVICE_B: ObjectID = new ObjectID("9900000000000000000000b2");

const MINUTE: number = 60 * 1000;
const T0: number = Date.parse("2026-11-09T10:00:00.000Z");

const TRACE_A: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01";
const TRACE_B: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa02";
const TRACE_C: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03";

function call(
  traceId: string,
  startMs: number,
  endMs: number,
  spanId: string = "b000000000000001",
): LlmLogEventCall {
  return {
    spanId: spanId,
    traceId: traceId,
    startMs: startMs,
    endMs: endMs,
    isModelCall: true,
  };
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function answer(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return { data: rows };
    },
  };
}

// A stored record as the reads' SELECT returns it.
function row(record: LlmLogEventRecord, rowOffset: number = 0): JSONObject {
  return {
    traceId: record.traceId || "",
    spanId: record.spanId || "",
    timeUnixNano: String(record.timeUnixNano || "0"),
    observedTimeUnixNano: String(record.observedTimeUnixNano || "0"),
    rowOffset: String(rowOffset),
    attributes: record.attributes as JSONObject,
    body: typeof record.body === "string" ? record.body : "",
  };
}

function fixtureRows(fixture: GenAiLogEventFixture): Array<JSONObject> {
  return toStoredLogRecords(loadGenAiLogEventFixture(fixture), {
    arrivedAtNano: "1794199999000000000",
  }).map((record: LlmLogEventRecord, index: number): JSONObject => {
    return row(record, index);
  });
}

function serveLogs(
  rows: Array<JSONObject> | Error,
): ReturnType<typeof jest.spyOn> {
  return jest.spyOn(LogService, "executeQuery").mockImplementation((() => {
    return rows instanceof Error
      ? Promise.reject(rows)
      : Promise.resolve(answer(rows));
  }) as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the time windows a conversation's log events are read in", () => {
  test("a minute before a trace's first call to ten minutes after its last", () => {
    expect(LLM_LOG_EVENT_BEFORE_CALL_MS).toBe(MINUTE);
    expect(LLM_LOG_EVENT_AFTER_CALL_MS).toBe(10 * MINUTE);

    expect(
      LlmLogEventReader.getWindows([
        call(TRACE_A, T0, T0 + 2000, "b000000000000001"),
        call(TRACE_A, T0 + 5000, T0 + 9000, "b000000000000002"),
      ]),
    ).toEqual([
      {
        startMs: T0 - MINUTE,
        endMs: T0 + 9000 + 10 * MINUTE,
        traceIds: [TRACE_A],
      },
    ]);
  });

  test("a conversation that spans days reads minutes of logs, not days", () => {
    const windows: Array<LlmLogEventWindow> = LlmLogEventReader.getWindows([
      call(TRACE_A, T0, T0 + 1000),
      call(TRACE_B, T0 + 3 * 24 * 60 * MINUTE, T0 + 3 * 24 * 60 * MINUTE + 1),
    ]);

    expect(windows).toHaveLength(2);

    for (const window of windows) {
      expect(window.endMs - window.startMs).toBeLessThan(12 * MINUTE);
    }

    expect(windows[0]!.traceIds).toEqual([TRACE_A]);
    expect(windows[1]!.traceIds).toEqual([TRACE_B]);
  });

  test("windows that overlap are one, holding both traces", () => {
    expect(
      LlmLogEventReader.getWindows([
        call(TRACE_B, T0 + 2 * MINUTE, T0 + 3 * MINUTE),
        call(TRACE_A, T0, T0 + MINUTE),
      ]),
    ).toEqual([
      {
        startMs: T0 - MINUTE,
        endMs: T0 + 3 * MINUTE + 10 * MINUTE,
        traceIds: [TRACE_A, TRACE_B],
      },
    ]);
  });

  test("trace ids are compared and read in lower case", () => {
    expect(
      LlmLogEventReader.getWindows([
        call(TRACE_A.toUpperCase(), T0, T0 + 1000),
        call(TRACE_A, T0 + 2000, T0 + 3000),
      ]),
    ).toEqual([
      {
        startMs: T0 - MINUTE,
        endMs: T0 + 3000 + 10 * MINUTE,
        traceIds: [TRACE_A],
      },
    ]);
  });

  test("a call without a trace or a time is not looked for; an end before the start is the start", () => {
    expect(
      LlmLogEventReader.getWindows([
        call("", T0, T0 + 1000),
        call(TRACE_A, Number.NaN, T0),
        call(TRACE_B, T0, Number.POSITIVE_INFINITY),
      ]),
    ).toEqual([]);
    expect(LlmLogEventReader.getWindows([])).toEqual([]);

    expect(
      LlmLogEventReader.getWindows([call(TRACE_C, T0, T0 - 5000)]),
    ).toEqual([
      {
        startMs: T0 - MINUTE,
        endMs: T0 + 10 * MINUTE,
        traceIds: [TRACE_C],
      },
    ]);
  });

  test("past the most windows, the two closest are merged until it fits", () => {
    const hour: number = 60 * MINUTE;
    const calls: Array<LlmLogEventCall> = [
      call(TRACE_A, T0, T0),
      // An hour after A: the closest pair.
      call(TRACE_B, T0 + hour, T0 + hour),
      call(TRACE_C, T0 + 10 * hour, T0 + 10 * hour),
    ];

    const windows: Array<LlmLogEventWindow> = LlmLogEventReader.getWindows(
      calls,
      2,
    );

    expect(windows).toEqual([
      {
        startMs: T0 - MINUTE,
        endMs: T0 + hour + 10 * MINUTE,
        traceIds: [TRACE_A, TRACE_B],
      },
      {
        startMs: T0 + 10 * hour - MINUTE,
        endMs: T0 + 10 * hour + 10 * MINUTE,
        traceIds: [TRACE_C],
      },
    ]);

    // However many traces, one read stays at the most windows.
    const many: Array<LlmLogEventCall> = [];

    for (let index: number = 0; index < 500; index++) {
      many.push(
        call(
          `cccccccccccccccccccccccccccc${index.toString(16).padStart(4, "0")}`,
          T0 + index * hour,
          T0 + index * hour + 1000,
        ),
      );
    }

    const merged: Array<LlmLogEventWindow> = LlmLogEventReader.getWindows(many);

    expect(merged).toHaveLength(LLM_LOG_EVENT_MAX_WINDOWS);
    // No trace is lost on the way.
    expect(
      merged.flatMap((window: LlmLogEventWindow): Array<string> => {
        return window.traceIds;
      }),
    ).toHaveLength(500);
    expect(LlmLogEventReader.getWindows(many, 0)).toHaveLength(1);
  });
});

describe("the content read of some calls", () => {
  const windows: Array<LlmLogEventWindow> = LlmLogEventReader.getWindows([
    call(TRACE_A, T0, T0 + 1000),
    call(TRACE_B, T0 + 5 * 60 * MINUTE, T0 + 5 * 60 * MINUTE + 1000),
  ]);
  const statement: Statement = LlmLogEventReader.buildStatement({
    projectId: PROJECT,
    windows: windows,
    logFilter: { serviceIds: [SERVICE_A], excludedServiceIds: [SERVICE_B] },
    spanIds: ["B000000000000001", "b000000000000002"],
  });
  const sql: string = statement.query;

  test("reads the project's log table, rows still retained", () => {
    expect(sql).toContain("FROM LogItemV3 WHERE projectId = ");
    expect(sql).toContain("AND retentionDate >= now()");
    expect(paramValues(statement)).toContain(PROJECT.toString());
  });

  test("the columns a record is read from, a body too long to read left out", () => {
    expect(sql).toContain(
      "SELECT traceId, spanId, toString(timeUnixNano) AS timeUnixNano, toString(observedTimeUnixNano) AS observedTimeUnixNano, _part_offset AS rowOffset, attributes, " +
        `if(length(body) > ${LLM_MESSAGE_MAX_JSON_LENGTH}, '', body) AS body FROM LogItemV3`,
    );
  });

  test("each window is a time range with its traces' ids, as parameters", () => {
    expect(sql.split("(time >= ")).toHaveLength(3);
    expect(sql).toContain(" OR (time >= ");
    expect(sql).toContain("AND traceId IN (");
    expect(paramValues(statement)).toContainEqual([TRACE_A]);
    expect(paramValues(statement)).toContainEqual([TRACE_B]);
  });

  test("only the GenAI content events: by name, or a details record without one by its keys", () => {
    expect(paramValues(statement)).toContain(LlmLogEventNameAttributeKey);
    expect(paramValues(statement)).toContainEqual(LlmContentEventNames);
    expect(sql).toContain("] = '' AND hasAny(attributeKeys, ");
    expect(paramValues(statement)).toContainEqual(
      LlmInferenceDetailsContentAttributeKeys,
    );
  });

  test("the calls' span ids, in lower case, and the records that name no span", () => {
    expect(sql).toContain("AND (spanId IN (");
    expect(sql).toContain(") OR spanId = '')");
    expect(paramValues(statement)).toContainEqual([
      "b000000000000001",
      "b000000000000002",
    ]);
  });

  test("held to the caller's log scope, a WHERE", () => {
    expect(sql).toContain("AND primaryEntityId IN (");
    expect(sql).toContain("AND primaryEntityId NOT IN (");
    expect(paramValues(statement)).toContainEqual([SERVICE_A.toString()]);
    expect(paramValues(statement)).toContainEqual([SERVICE_B.toString()]);
    expect(sql.indexOf("primaryEntityId IN")).toBeLessThan(
      sql.indexOf(" ORDER BY "),
    );
  });

  test("the newest first, one more than it keeps, and a read cut short throws", () => {
    expect(sql).toContain(" ORDER BY time DESC LIMIT ");
    expect(paramValues(statement)).toContain(LLM_LOG_EVENT_MAX_RECORDS + 1);
    expect(sql).toContain("max_execution_time = 12");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("'break'");
  });

  test("no span ids: every content record of the traces", () => {
    const traceOnly: Statement = LlmLogEventReader.buildStatement({
      projectId: PROJECT,
      windows: windows,
      logFilter: {},
    });

    expect(traceOnly.query).not.toContain("spanId IN");
    expect(traceOnly.query).not.toContain("primaryEntityId");
  });

  test("ids that arrived in a request never reach the SQL text", () => {
    const hostile: string = "x') OR 1=1; DROP TABLE LogItemV3; --";
    const injected: Statement = LlmLogEventReader.buildStatement({
      projectId: PROJECT,
      windows: [{ startMs: T0, endMs: T0 + 1000, traceIds: [hostile] }],
      logFilter: {},
      spanIds: [hostile],
    });

    expect(injected.query).not.toContain("DROP TABLE");
    expect(paramValues(injected)).toContainEqual([hostile]);
    expect(paramValues(injected)).toContainEqual([hostile.toLowerCase()]);
  });
});

describe("the title read of conversation list rows", () => {
  const statement: Statement = LlmLogEventReader.buildTitleStatement({
    projectId: PROJECT,
    windows: [{ startMs: T0, endMs: T0 + MINUTE, traceIds: [TRACE_A] }],
    logFilter: { serviceIds: [SERVICE_A] },
  });

  test("the person's messages, and details records, the oldest first, a few per trace", () => {
    expect(paramValues(statement)).toContainEqual([
      "gen_ai.user.message",
      LlmInferenceDetailsEventName,
    ]);
    expect(statement.query).toContain(" ORDER BY time ASC LIMIT ");
    expect(statement.query).toContain(" BY traceId LIMIT ");
    expect(paramValues(statement)).toContain(
      LLM_LOG_EVENT_TITLE_RECORDS_PER_TRACE,
    );
    expect(paramValues(statement)).toContain(LLM_LOG_EVENT_MAX_RECORDS);
  });

  test("in the caller's log scope, cut short with an error", () => {
    expect(statement.query).toContain("AND primaryEntityId IN (");
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
  });
});

describe("a row as a record", () => {
  test("every column read as the record has it", () => {
    expect(
      LlmLogEventReader.toRecord({
        traceId: TRACE_A,
        spanId: "b000000000000001",
        timeUnixNano: "1794198568695000000",
        observedTimeUnixNano: "1794198568696000000",
        rowOffset: "12",
        attributes: { "event.name": "gen_ai.user.message" },
        body: '{"content":"Hi"}',
      }),
    ).toEqual({
      traceId: TRACE_A,
      spanId: "b000000000000001",
      timeUnixNano: "1794198568695000000",
      observedTimeUnixNano: "1794198568696000000",
      rowOffset: "12",
      attributes: { "event.name": "gen_ai.user.message" },
      body: '{"content":"Hi"}',
    });
  });

  test("columns of another type read as nothing, never throw", () => {
    expect(
      LlmLogEventReader.toRecord({
        traceId: 7,
        spanId: null,
        attributes: "not a map",
        body: { content: "Hi" },
      } as unknown as JSONObject),
    ).toEqual({
      traceId: "",
      spanId: "",
      timeUnixNano: undefined,
      observedTimeUnixNano: undefined,
      rowOffset: undefined,
      attributes: {},
      body: "",
    });
    expect(LlmLogEventReader.toRecord({}).attributes).toEqual({});
  });
});

describe("reading the records of some calls", () => {
  test("one query, the records oldest first", async () => {
    const rows: Array<JSONObject> = fixtureRows(
      GenAiLogEventFixture.JavaScriptContent,
    );
    const spans: Array<StoredGenAiSpan> = toStoredSpans(
      loadGenAiLogEventFixture(GenAiLogEventFixture.JavaScriptContent),
    );
    const spy: ReturnType<typeof jest.spyOn> = serveLogs([...rows].reverse());

    const result: LlmLogEventReadResult = await LlmLogEventReader.readForCalls({
      projectId: PROJECT,
      calls: spans.map((span: StoredGenAiSpan): LlmLogEventCall => {
        return call(span.traceId, span.startMs, span.endMs, span.spanId);
      }),
      logFilter: { serviceIds: [SERVICE_A] },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBe(false);
    expect(result.records).toHaveLength(rows.length);

    // Nanosecond times of one length: compared as text, oldest first.
    const times: Array<string> = result.records.map(
      (record: LlmLogEventRecord): string => {
        return String(record.timeUnixNano);
      },
    );

    expect(
      times.every((time: string): boolean => {
        return time.length === 19;
      }),
    ).toBe(true);
    expect([...times].sort()).toEqual(times);

    const sent: Statement = spy.mock.calls[0]![0] as Statement;

    for (const span of spans) {
      expect(paramValues(sent)).toContainEqual(
        expect.arrayContaining([span.spanId]),
      );
    }
  });

  test("more rows than it keeps: the newest kept, and it says so", async () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index <= LLM_LOG_EVENT_MAX_RECORDS; index++) {
      rows.push({
        traceId: TRACE_A,
        spanId: "b000000000000001",
        // Newest first, as the read orders them.
        timeUnixNano: `${T0 + LLM_LOG_EVENT_MAX_RECORDS - index}000000`,
        observedTimeUnixNano: "0",
        rowOffset: "0",
        attributes: { "event.name": "gen_ai.user.message" },
        body: JSON.stringify({ content: `message ${index}` }),
      });
    }

    serveLogs(rows);

    const result: LlmLogEventReadResult = await LlmLogEventReader.readForCalls({
      projectId: PROJECT,
      calls: [call(TRACE_A, T0, T0 + 1000)],
      logFilter: {},
    });

    expect(result.truncated).toBe(true);
    expect(result.records).toHaveLength(LLM_LOG_EVENT_MAX_RECORDS);
    // The oldest row (the last one read) is the one left out.
    expect(
      result.records.some((record: LlmLogEventRecord): boolean => {
        return String(record.body).includes(
          `message ${LLM_LOG_EVENT_MAX_RECORDS}"`,
        );
      }),
    ).toBe(false);
  });

  test("calls without a trace or a time: nothing is read", async () => {
    const spy: ReturnType<typeof jest.spyOn> = serveLogs([]);

    expect(
      await LlmLogEventReader.readForCalls({
        projectId: PROJECT,
        calls: [call("", T0, T0 + 1000)],
        logFilter: {},
      }),
    ).toEqual({ records: [], truncated: false });
    expect(spy).not.toHaveBeenCalled();
  });

  test("a read that fails throws: could not read is not nothing there", async () => {
    serveLogs(new Error("Timeout exceeded: elapsed 12.1 seconds"));

    await expect(
      LlmLogEventReader.readForCalls({
        projectId: PROJECT,
        calls: [call(TRACE_A, T0, T0 + 1000)],
        logFilter: {},
      }),
    ).rejects.toThrow("Timeout exceeded");
  });
});

describe("a conversation's title from its log events", () => {
  test.each([
    [GenAiLogEventFixture.JavaScriptContent, "Say this is a test."],
    [GenAiLogEventFixture.PythonOpenAiV2True, "Say this is a test."],
    [GenAiLogEventFixture.PythonOpenAiV2EventOnly, "Say this is a test."],
    [GenAiLogEventFixture.PythonGenAiOpenAiEventOnly, "Say this is a test."],
    [GenAiLogEventFixture.JavaContent, "Say this is a test."],
  ])(
    "%s: the first call's question",
    (fixture: GenAiLogEventFixture, title: string) => {
      const records: Array<LlmLogEventRecord> = toStoredLogRecords(
        loadGenAiLogEventFixture(fixture),
        { arrivedAtNano: "1794199999000000000" },
      );
      const firstTrace: string = toStoredSpans(
        loadGenAiLogEventFixture(fixture),
      )[0]!.traceId;

      expect(
        LlmLogEventReader.getTitle(
          records.filter((record: LlmLogEventRecord): boolean => {
            return record.traceId === firstTrace;
          }),
        ),
      ).toBe(title);
    },
  );

  test("content capture off: no title", () => {
    for (const fixture of [
      GenAiLogEventFixture.JavaScriptNoContent,
      GenAiLogEventFixture.PythonOpenAiV2NoContent,
      GenAiLogEventFixture.JavaNoContent,
    ]) {
      expect(
        LlmLogEventReader.getTitle(
          toStoredLogRecords(loadGenAiLogEventFixture(fixture)),
        ),
      ).toBe("");
    }
  });

  test("the first span with a question gives its newest one, previewed", () => {
    const longQuestion: string = `Plan   my\ttrip\n${"to Paris ".repeat(100)}`;
    const records: Array<LlmLogEventRecord> = [
      // The first span asked nothing of its own: only a system prompt.
      {
        traceId: TRACE_A,
        spanId: "b000000000000001",
        timeUnixNano: "1000",
        attributes: { "event.name": "gen_ai.system.message" },
        body: JSON.stringify({ content: "You are a travel bot." }),
      },
      {
        traceId: TRACE_A,
        spanId: "b000000000000002",
        timeUnixNano: "2000",
        attributes: { "event.name": "gen_ai.user.message" },
        body: JSON.stringify({ content: "Hello" }),
      },
      {
        traceId: TRACE_A,
        spanId: "b000000000000002",
        timeUnixNano: "3000",
        attributes: { "event.name": "gen_ai.user.message" },
        body: JSON.stringify({ content: longQuestion }),
      },
      {
        traceId: TRACE_A,
        spanId: "b000000000000003",
        timeUnixNano: "4000",
        attributes: { "event.name": "gen_ai.user.message" },
        body: JSON.stringify({ content: "A later question" }),
      },
    ];

    const title: string = LlmLogEventReader.getTitle(records);

    expect(title.startsWith("Plan my trip to Paris to Paris")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(LLM_USER_MESSAGE_PREVIEW_LENGTH);
  });

  test("no records, or none that say anything: no title", () => {
    expect(LlmLogEventReader.getTitle([])).toBe("");
    expect(
      LlmLogEventReader.getTitle([
        {
          traceId: TRACE_A,
          spanId: "b000000000000001",
          attributes: { "event.name": "gen_ai.user.message" },
          body: JSON.stringify({ content: "   " }),
        },
      ]),
    ).toBe("");
  });

  test("titles of list rows: one query, a row without one left out", async () => {
    const fixture: GenAiLogEventFixture =
      GenAiLogEventFixture.JavaScriptContent;
    const spans: Array<StoredGenAiSpan> = toStoredSpans(
      loadGenAiLogEventFixture(fixture),
    );
    const spy: ReturnType<typeof jest.spyOn> = serveLogs(
      fixtureRows(fixture).filter((stored: JSONObject): boolean => {
        return (
          (stored["attributes"] as JSONObject)["event.name"] ===
          "gen_ai.user.message"
        );
      }),
    );

    const titles: Map<string, string> = await LlmLogEventReader.readTitles({
      projectId: PROJECT,
      requests: [
        {
          key: "t:first",
          traceId: spans[0]!.traceId.toUpperCase(),
          startedAtMs: spans[0]!.startMs,
        },
        { key: "t:unknown", traceId: TRACE_C, startedAtMs: T0 },
        { key: "t:no-trace", traceId: "", startedAtMs: T0 },
        { key: "t:no-time", traceId: TRACE_B, startedAtMs: Number.NaN },
      ],
      logFilter: { serviceIds: [SERVICE_A] },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(Array.from(titles.entries())).toEqual([
      ["t:first", "Say this is a test."],
    ]);
  });

  test("no row to title: nothing is read", async () => {
    const spy: ReturnType<typeof jest.spyOn> = serveLogs([]);

    expect(
      (
        await LlmLogEventReader.readTitles({
          projectId: PROJECT,
          requests: [],
          logFilter: {},
        })
      ).size,
    ).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  test("a title read that fails throws", async () => {
    serveLogs(new Error("Timeout exceeded"));

    await expect(
      LlmLogEventReader.readTitles({
        projectId: PROJECT,
        requests: [{ key: "t:a", traceId: TRACE_A, startedAtMs: T0 }],
        logFilter: {},
      }),
    ).rejects.toThrow("Timeout exceeded");
  });
});
