import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import {
  LlmConversationKeyKind,
  LlmConversationListItem,
  LlmConversationListResponse,
  LlmConversationSort,
  LlmLogEventsRead,
} from "Common/Types/Telemetry/LlmConversationApi";
import {
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "Common/Utils/Telemetry/LlmConversationTranscript";
import { LlmLogEventRecord } from "Common/Utils/Telemetry/LlmLogEvents";
import {
  GenAiLogEventFixture,
  GenAiLogEventFixtureFile,
  StoredGenAiSpan,
  loadGenAiLogEventFixture,
  toStoredLogRecords,
  toStoredSpans,
} from "Common/Tests/Helpers/GenAiLogEventFixtures";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Prompts and answers sent as GenAI log events, read into AI
 * conversations against a real ClickHouse (#6348).
 *
 * The unit tests pin the SQL LlmLogEventReader writes and what the
 * conversation makes of the rows. What they cannot show is that ClickHouse
 * accepts that SQL - the time windows, the Map lookups on event.name,
 * hasAny over attributeKeys, _part_offset, LIMIT n BY traceId - and that
 * what the OpenTelemetry instrumentations really sent
 * (Common/Tests/Fixtures/GenAiLogEvents), stored as log ingest stores it,
 * comes back into the right call of the right conversation: by span id, at
 * the time a record carried or - when it carried none (Java, Python on a
 * newer SDK) - the time its SDK observed it (#6395). Rows stored before
 * that, at the time they arrived, are read too while they arrived within a
 * minute of their call.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/LlmLogEventsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import LlmConversationService, {
  LlmConversationDetail,
} from "Common/Server/Services/LlmConversationService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `llm_log_events_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("8810000000000000000000a1");
const otherProjectId: ObjectID = new ObjectID("8810000000000000000000a2");
const chatApp: ObjectID = new ObjectID("8810000000000000000000b1");
const otherApp: ObjectID = new ObjectID("8810000000000000000000b2");

const SECOND_NANO: bigint = BigInt(1000000000);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

const FAKE_ANSWER: string =
  "This is a test answer from the fake OpenAI server.";
const THE_QUESTIONS: Array<string> = [
  "Say this is a test.",
  "What is the weather in Paris?",
  "Write a haiku about logs.",
  "Stream me an answer.",
];

/*
 * One captured app, stored under a conversation id of its own. A record
 * that sent no time of its own is stored at its observed time, as ingest
 * stores it since #6395; with `storedAtArrival`, at the time it arrived, as
 * ingest stored it before: its observed time plus `arrivalDelayMs` (the
 * export batch and the queue). `idShift` gives the capture trace and span
 * ids of its own, so the same capture can be stored twice.
 */
interface CapturedApp {
  fixture: GenAiLogEventFixture;
  conversationId: string;
  projectId?: ObjectID;
  storedAtArrival?: boolean;
  arrivalDelayMs?: number;
  idShift?: number;
}

const APPS: Array<CapturedApp> = [
  {
    fixture: GenAiLogEventFixture.JavaScriptContent,
    conversationId: "conv-javascript",
  },
  {
    fixture: GenAiLogEventFixture.JavaContent,
    conversationId: "conv-java",
  },
  {
    fixture: GenAiLogEventFixture.PythonOpenAiV2True,
    conversationId: "conv-python-true",
  },
  {
    fixture: GenAiLogEventFixture.PythonOpenAiV2EventOnly,
    conversationId: "conv-python-event-only",
  },
  {
    fixture: GenAiLogEventFixture.PythonOpenAiV2SpanAndEvent,
    conversationId: "conv-python-span-and-event",
  },
  {
    fixture: GenAiLogEventFixture.JavaNoContent,
    conversationId: "conv-java-no-content",
  },
  // The same Java capture in another project: never read into this one.
  {
    fixture: GenAiLogEventFixture.JavaContent,
    conversationId: "conv-java",
    projectId: otherProjectId,
  },
  // Stored before #6395, 50 seconds after it was sent: still read.
  {
    fixture: GenAiLogEventFixture.JavaContent,
    conversationId: "conv-java-stored-before",
    storedAtArrival: true,
    arrivalDelayMs: 50 * 1000,
    idShift: 2,
  },
  // Stored before #6395, two minutes after it was sent: no longer read.
  {
    fixture: GenAiLogEventFixture.PythonOpenAiV2True,
    conversationId: "conv-python-stored-before-late",
    storedAtArrival: true,
    arrivalDelayMs: 2 * 60 * 1000,
    idShift: 3,
  },
];

/*
 * The JavaScript capture's records, stored again two minutes late: past
 * the minute after a call its records are looked for in (ten before #6395).
 */
const LATE_CONVERSATION_ID: string = "conv-javascript-late";
const LATE_DELAY_MS: number = 2 * 60 * 1000;

// Another trace or span id: its first hex digit changed by `shift`.
function shiftId(id: string, shift: number | undefined): string {
  if (!id || !shift) {
    return id;
  }

  return `${(parseInt(id[0]!, 16) ^ shift).toString(16)}${id.substring(1)}`;
}

let windowStart: Date = new Date();
let windowEnd: Date = new Date();

function nanoText(nano: bigint): string {
  return nano.toString();
}

function spanRow(
  span: StoredGenAiSpan,
  app: { conversationId: string; projectId?: ObjectID },
): JSONObject {
  const start: Date = new Date(span.startMs);
  const end: Date = new Date(span.endMs);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (app.projectId || projectId).toString(),
    primaryEntityId: chatApp.toString(),
    primaryEntityType: "Service",
    // As trace ingest stores a span: the whole second, then the exact times.
    startTime: OneUptimeDate.toClickhouseDateTime(start),
    endTime: OneUptimeDate.toClickhouseDateTime(end),
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    durationUnixNano: nanoText(
      BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano),
    ),
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: "SPAN_KIND_CLIENT",
    statusCode: 1,
    statusMessage: "",
    attributes: span.attributes,
    attributeKeys: Object.keys(span.attributes),
    events: JSON.stringify(span.events),
    isLlmSpan: true,
    llmSystem: "openai",
    llmOperation: "chat",
    llmRequestModel: "gpt-4o-mini",
    llmConversationId: app.conversationId,
    llmCallKind: "answer",
    llmIssues: [],
    llmUserMessagePreview: "",
    retentionDate: retentionDate,
  };
}

function logRow(
  record: LlmLogEventRecord,
  data: { projectId: ObjectID; arrivalDelayMs: number; sentinel: string },
): JSONObject {
  // A record stored before #6395 at the time it arrived.
  const timeNano: bigint =
    String(record.timeUnixNano) === data.sentinel
      ? BigInt(String(record.observedTimeUnixNano)) +
        BigInt(data.arrivalDelayMs) * BigInt(1000000)
      : BigInt(String(record.timeUnixNano));
  const time: Date = new Date(Number(timeNano / BigInt(1000000)));

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: data.projectId.toString(),
    primaryEntityId: chatApp.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time, nanoText(timeNano)),
    timeUnixNano: nanoText(timeNano),
    observedTimeUnixNano: String(record.observedTimeUnixNano || "0"),
    severityText: "INFO",
    severityNumber: 9,
    attributes: record.attributes as JSONObject,
    attributeKeys: Object.keys(record.attributes as JSONObject),
    body: String(record.body || ""),
    traceId: record.traceId || "",
    spanId: record.spanId || "",
    retentionDate: retentionDate,
  };
}

// A record's time when it sent none, recognized when the rows are made.
const NO_TIME_SENTINEL: string = "1";

function rowsOf(app: CapturedApp): {
  spans: Array<JSONObject>;
  logs: Array<JSONObject>;
} {
  const file: GenAiLogEventFixtureFile = loadGenAiLogEventFixture(app.fixture);

  return {
    spans: toStoredSpans(file).map((span: StoredGenAiSpan): JSONObject => {
      return spanRow(
        {
          ...span,
          traceId: shiftId(span.traceId, app.idShift),
          spanId: shiftId(span.spanId, app.idShift),
          parentSpanId: shiftId(span.parentSpanId, app.idShift),
        },
        app,
      );
    }),
    logs: toStoredLogRecords(file, {
      arrivedAtNano: NO_TIME_SENTINEL,
      storedAtArrival: app.storedAtArrival,
    }).map((record: LlmLogEventRecord): JSONObject => {
      return logRow(
        {
          ...record,
          traceId: shiftId(record.traceId || "", app.idShift),
          spanId: shiftId(record.spanId || "", app.idShift),
        },
        {
          projectId: app.projectId || projectId,
          arrivalDelayMs: app.arrivalDelayMs || 0,
          sentinel: NO_TIME_SENTINEL,
        },
      );
    }),
  };
}

/*
 * The JavaScript capture under new trace and span ids, its records stored
 * LATE_DELAY_MS after they were sent: past the minute after its call that
 * a call's records are looked for in.
 */
function lateRows(): { spans: Array<JSONObject>; logs: Array<JSONObject> } {
  const file: GenAiLogEventFixtureFile = loadGenAiLogEventFixture(
    GenAiLogEventFixture.JavaScriptContent,
  );
  const renamed: (id: string) => string = (id: string): string => {
    return shiftId(id, 1);
  };

  return {
    spans: toStoredSpans(file).map((span: StoredGenAiSpan): JSONObject => {
      return spanRow(
        {
          ...span,
          traceId: renamed(span.traceId),
          spanId: renamed(span.spanId),
        },
        { conversationId: LATE_CONVERSATION_ID },
      );
    }),
    logs: toStoredLogRecords(file).map(
      (record: LlmLogEventRecord): JSONObject => {
        return logRow(
          {
            ...record,
            traceId: renamed(record.traceId || ""),
            spanId: renamed(record.spanId || ""),
            timeUnixNano: nanoText(
              BigInt(String(record.timeUnixNano)) +
                BigInt(LATE_DELAY_MS) * BigInt(1000000),
            ),
          },
          {
            projectId: projectId,
            arrivalDelayMs: 0,
            sentinel: NO_TIME_SENTINEL,
          },
        );
      },
    ),
  };
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

type WiredService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
};

const EVERY_LOG: TelemetryReadScope =
  TelemetryReadScopeUtil.getUnrestrictedScope();

async function open(
  conversationId: string,
  logScope: TelemetryReadScope | null = EVERY_LOG,
  inProject: ObjectID = projectId,
): Promise<LlmConversationDetail> {
  return LlmConversationService.getConversation({
    projectId: inProject,
    key: { kind: LlmConversationKeyKind.Conversation, value: conversationId },
    startTime: windowStart,
    endTime: windowEnd,
    logScope: logScope,
  });
}

function stepTexts(
  detail: LlmConversationDetail,
  type: LlmTranscriptStepType,
): Array<string> {
  return detail.transcript.steps
    .filter((step: LlmTranscriptStep): boolean => {
      return step.type === type;
    })
    .map((step: LlmTranscriptStep): string => {
      return step.text;
    });
}

integration(
  "GenAI log events read into AI conversations against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    const originals: Array<{ service: WiredService; saved: WiredService }> = [];

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 60000,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      for (const modelType of [Span, Log]) {
        await createTable(
          client,
          clickhouse,
          modelType as unknown as { new (): AnalyticsBaseModel },
        );
      }

      for (const service of [SpanService, LogService]) {
        const wired: WiredService = service as unknown as WiredService;

        originals.push({
          service: wired,
          saved: {
            database: wired.database,
            databaseClient: wired.databaseClient,
            ingestDatabase: wired.ingestDatabase,
            ingestDatabaseClient: wired.ingestDatabaseClient,
          },
        });

        wired.database = clickhouse;
        wired.databaseClient = client;
        wired.ingestDatabase = clickhouse;
        wired.ingestDatabaseClient = client;
      }

      const spans: Array<JSONObject> = [];
      const logs: Array<JSONObject> = [];

      for (const app of APPS) {
        const rows: { spans: Array<JSONObject>; logs: Array<JSONObject> } =
          rowsOf(app);
        spans.push(...rows.spans);
        logs.push(...rows.logs);
      }

      const late: { spans: Array<JSONObject>; logs: Array<JSONObject> } =
        lateRows();
      spans.push(...late.spans);
      logs.push(...late.logs);

      // A window around every capture (all made on 2026-11-09).
      const startMs: Array<number> = spans.map((row: JSONObject): number => {
        return Number(BigInt(String(row["startTimeUnixNano"])) / SECOND_NANO);
      });
      windowStart = new Date((Math.min(...startMs) - 3600) * 1000);
      windowEnd = new Date((Math.max(...startMs) + 3600) * 1000);

      await SpanService.insertJsonRows(spans, {
        clickhouseSettings: { wait_for_async_insert: 1 },
      });
      await LogService.insertJsonRows(logs, {
        clickhouseSettings: { wait_for_async_insert: 1 },
      });
    });

    afterAll(async (): Promise<void> => {
      for (const original of originals) {
        Object.assign(original.service, original.saved);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test.each([
      ["conv-javascript"],
      ["conv-java"],
      ["conv-python-true"],
      ["conv-python-event-only"],
      ["conv-java-stored-before"],
    ])(
      "%s: every call's prompt and answer, read from its log events",
      async (conversationId: string) => {
        const detail: LlmConversationDetail = await open(conversationId);

        expect(detail.logEvents).toBe(LlmLogEventsRead.Read);
        expect(detail.transcript.contentRecorded).toBe(true);
        expect(
          stepTexts(detail, LlmTranscriptStepType.UserMessage).slice(0, 4),
        ).toEqual(THE_QUESTIONS);
        expect(
          stepTexts(detail, LlmTranscriptStepType.AssistantMessage),
        ).toContain(FAKE_ANSWER);
        expect(detail.transcript.instructions).toBe(
          "You are a helpful assistant.",
        );
        // The tool round trip: the call the model asked for.
        expect(
          detail.transcript.steps.filter((step: LlmTranscriptStep): boolean => {
            return step.type === LlmTranscriptStepType.ToolCall;
          }).length,
        ).toBeGreaterThan(0);
      },
    );

    test("spans that record what was said read no log, and show each message once", async () => {
      const detail: LlmConversationDetail = await open(
        "conv-python-span-and-event",
      );

      expect(detail.logEvents).toBe(LlmLogEventsRead.NotNeeded);
      expect(
        stepTexts(detail, LlmTranscriptStepType.UserMessage).slice(0, 4),
      ).toEqual(THE_QUESTIONS);
    });

    test("content capture off: the events are read, and say nothing", async () => {
      const detail: LlmConversationDetail = await open("conv-java-no-content");

      expect(detail.logEvents).toBe(LlmLogEventsRead.Read);
      expect(stepTexts(detail, LlmTranscriptStepType.UserMessage)).toEqual([]);
      expect(stepTexts(detail, LlmTranscriptStepType.AssistantMessage)).toEqual(
        [],
      );
    });

    test("a reader of other apps' logs only: nothing read, and the conversation says so", async () => {
      const detail: LlmConversationDetail = await open("conv-java", {
        readableIds: [otherApp.toString()],
        blockedIds: [],
      });

      expect(detail.logEvents).toBe(LlmLogEventsRead.NotAllowed);
      expect(stepTexts(detail, LlmTranscriptStepType.UserMessage)).toEqual([]);
    });

    test("a reader who may read the app's logs, by id: read", async () => {
      const detail: LlmConversationDetail = await open("conv-java", {
        readableIds: [chatApp.toString()],
        blockedIds: [],
      });

      expect(detail.logEvents).toBe(LlmLogEventsRead.Read);
      expect(stepTexts(detail, LlmTranscriptStepType.UserMessage)[0]).toBe(
        "Say this is a test.",
      );
    });

    test("another project's records are never read into this one", async () => {
      /*
       * The other project holds the same Java capture under the same ids;
       * this one's conversation reads its own records, once each.
       */
      const detail: LlmConversationDetail = await open("conv-java");

      expect(
        stepTexts(detail, LlmTranscriptStepType.UserMessage).filter(
          (text: string): boolean => {
            return text === "Say this is a test.";
          },
        ),
      ).toHaveLength(1);

      const elsewhere: LlmConversationDetail = await open(
        "conv-java",
        EVERY_LOG,
        otherProjectId,
      );

      expect(elsewhere.logEvents).toBe(LlmLogEventsRead.Read);
      expect(stepTexts(elsewhere, LlmTranscriptStepType.UserMessage)[0]).toBe(
        "Say this is a test.",
      );
    });

    test("records stored more than a minute after their call are not looked for (ten minutes before #6395)", async () => {
      const detail: LlmConversationDetail = await open(LATE_CONVERSATION_ID);

      expect(detail.logEvents).toBe(LlmLogEventsRead.Read);
      expect(stepTexts(detail, LlmTranscriptStepType.UserMessage)).toEqual([]);
    });

    test("rows stored before #6395 at the time they arrived: read when they arrived within a minute of their call, not two minutes after", async () => {
      const within: LlmConversationDetail = await open(
        "conv-java-stored-before",
      );
      const late: LlmConversationDetail = await open(
        "conv-python-stored-before-late",
      );

      expect(
        stepTexts(within, LlmTranscriptStepType.UserMessage).slice(0, 4),
      ).toEqual(THE_QUESTIONS);
      expect(late.logEvents).toBe(LlmLogEventsRead.Read);
      expect(stepTexts(late, LlmTranscriptStepType.UserMessage)).toEqual([]);
    });

    test("a list row whose spans recorded no question is titled from its log events", async () => {
      const response: LlmConversationListResponse =
        await LlmConversationService.listConversations({
          projectId: projectId,
          startTime: windowStart,
          endTime: windowEnd,
          sort: LlmConversationSort.Newest,
          limit: 25,
          skip: 0,
          includeSummary: false,
          logScope: EVERY_LOG,
        });

      const titles: Record<string, string> = {};

      for (const row of response.conversations) {
        titles[row.conversationId] = row.title;
      }

      expect(titles["conv-javascript"]).toBe("Say this is a test.");
      expect(titles["conv-java"]).toBe("Say this is a test.");
      expect(titles["conv-python-true"]).toBe("Say this is a test.");
      expect(titles["conv-python-event-only"]).toBe("Say this is a test.");
      expect(titles["conv-java-no-content"]).toBe("");
      // A title is still looked for ten minutes past the conversation's start.
      expect(titles["conv-java-stored-before"]).toBe("Say this is a test.");
      expect(titles["conv-python-stored-before-late"]).toBe(
        "Say this is a test.",
      );

      // Without the logs, no title from them.
      const unread: LlmConversationListResponse =
        await LlmConversationService.listConversations({
          projectId: projectId,
          startTime: windowStart,
          endTime: windowEnd,
          sort: LlmConversationSort.Newest,
          limit: 25,
          skip: 0,
          includeSummary: false,
          logScope: null,
        });

      expect(
        unread.conversations.find((row: LlmConversationListItem): boolean => {
          return row.conversationId === "conv-java";
        })?.title,
      ).toBe("");
    });
  },
);

describe("GenAI log events ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
