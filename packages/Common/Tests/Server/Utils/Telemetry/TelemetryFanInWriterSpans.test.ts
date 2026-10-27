import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Span, SpanContext, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  FanInInsertTarget,
  FanInSubmitResult,
  FanInWriterOptions,
  TelemetryFanInWriter,
} from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import Telemetry from "../../../../Server/Utils/Telemetry";
import { JSONObject } from "../../../../Types/JSON";

/*
 * WHERE A JOB'S ROWS SPEND THEIR TIME.
 *
 * A metrics job on test.oneuptime.com showed 4.26 s of "self time" in
 * OtelMetricsIngestService.processMetricsAsync: the time its rows waited in
 * this writer - for their batch to fill or its 5 s timer, for an insert slot
 * - and the insert itself, none of which was in any trace. Now each traced
 * submission is a span of the job, from submit() to its ack, and each batch
 * is a trace of its own holding the inserts; the two link to each other.
 */

jest.mock("../../../../Server/Utils/Logger");

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

const OPTIONS: FanInWriterOptions = {
  maxBatchRows: 100,
  maxWaitMs: 20,
  maxConcurrentInserts: 2,
  maxPendingRows: 1000,
  retryMaxAttempts: 2,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 2,
  sleep: async (): Promise<void> => {
    // no backoff
  },
};

interface Insert {
  rows: number;
  // The span active while the insert ran.
  activeSpan: SpanContext | undefined;
}

function newTarget(fail: boolean = false): {
  target: FanInInsertTarget;
  inserts: Array<Insert>;
} {
  const inserts: Array<Insert> = [];

  return {
    inserts: inserts,
    target: {
      model: { tableName: "MetricItemV2" },
      insertJsonRows: async (rows: Array<JSONObject>): Promise<void> => {
        inserts.push({
          rows: rows.length,
          activeSpan: trace.getActiveSpan()?.spanContext(),
        });
        if (fail) {
          throw new Error("Code: 62. DB::Exception: Syntax error");
        }
      },
    },
  };
}

function rows(count: number): Array<JSONObject> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return { index: index };
  });
}

function spansNamed(name: string): Array<ReadableSpan> {
  return exporter.getFinishedSpans().filter((span: ReadableSpan) => {
    return span.name === name;
  });
}

// A job that submits rows and waits for its ack, as the ingest services do.
async function job(
  name: string,
  writer: TelemetryFanInWriter,
  target: FanInInsertTarget,
  rowCount: number,
): Promise<string> {
  return trace
    .getTracer("test")
    .startActiveSpan(name, async (span: Span): Promise<string> => {
      try {
        const submission: FanInSubmitResult = await writer.submit(
          target,
          rows(rowCount),
        );
        await submission.flushed.catch(() => {
          // The job's own error handling is not what is tested here.
        });
        return span.spanContext().spanId;
      } finally {
        span.end();
      }
    });
}

beforeAll(() => {
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
});

afterAll(() => {
  trace.disable();
  context.disable();
});

beforeEach(() => {
  exporter.reset();
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TelemetryFanInWriter spans", () => {
  test("a job's submission is a span of the job, from submit until its ack", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(OPTIONS);
    const { target } = newTarget();

    const jobSpanId: string = await job("job A", writer, target, 5);

    const [submission] = spansNamed("TelemetryFanInWriter.submit MetricItemV2");

    expect(submission!.parentSpanContext?.spanId).toBe(jobSpanId);
    expect(submission!.attributes).toEqual({
      "oneuptime.fanin.table": "MetricItemV2",
      "oneuptime.fanin.rows": 5,
    });
    expect(
      submission!.events.map((event: { name: string }) => {
        return event.name;
      }),
    ).toEqual(["fanin.buffered", "fanin.batched"]);
    // It waited for the 20 ms timer, and that wait is now in the trace.
    expect(
      submission!.duration[0] * 1000 + submission!.duration[1] / 1e6,
    ).toBeGreaterThanOrEqual(15);
  });

  test("the batch is a trace of its own holding the insert, linked both ways", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(OPTIONS);
    const { target, inserts } = newTarget();

    const jobSpanId: string = await job("job A", writer, target, 5);

    const [batch] = spansNamed("TelemetryFanInWriter.insert MetricItemV2");
    const [submission] = spansNamed("TelemetryFanInWriter.submit MetricItemV2");

    // Not a child of the job whose timer happened to cut it.
    expect(batch!.parentSpanContext).toBeUndefined();
    expect(batch!.spanContext().traceId).not.toBe(
      submission!.spanContext().traceId,
    );
    expect(batch!.attributes).toEqual({
      "oneuptime.fanin.table": "MetricItemV2",
      "oneuptime.fanin.rows": 5,
      "oneuptime.fanin.submissions": 1,
    });

    // The insert ran inside the batch's span.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.activeSpan?.spanId).toBe(batch!.spanContext().spanId);
    expect(inserts[0]!.activeSpan?.spanId).not.toBe(jobSpanId);

    expect(
      batch!.links.map((link: { context: SpanContext }) => {
        return link.context.spanId;
      }),
    ).toEqual([submission!.spanContext().spanId]);
    expect(
      submission!.links.map((link: { context: SpanContext }) => {
        return link.context.spanId;
      }),
    ).toEqual([batch!.spanContext().spanId]);
  });

  test("one batch of two jobs' rows links to both", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(OPTIONS);
    const { target, inserts } = newTarget();

    await Promise.all([
      job("job A", writer, target, 3),
      job("job B", writer, target, 4),
    ]);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.rows).toBe(7);

    const batches: Array<ReadableSpan> = spansNamed(
      "TelemetryFanInWriter.insert MetricItemV2",
    );
    const submissions: Array<ReadableSpan> = spansNamed(
      "TelemetryFanInWriter.submit MetricItemV2",
    );

    expect(batches).toHaveLength(1);
    expect(submissions).toHaveLength(2);
    expect(batches[0]!.attributes["oneuptime.fanin.submissions"]).toBe(2);
    expect(
      batches[0]!.links
        .map((link: { context: SpanContext }) => {
          return link.context.spanId;
        })
        .sort(),
    ).toEqual(
      submissions
        .map((span: ReadableSpan) => {
          return span.spanContext().spanId;
        })
        .sort(),
    );
  });

  test("an insert that fails for good is an ERROR on both spans, never an exception event", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(OPTIONS);
    const { target } = newTarget(true);

    await job("job A", writer, target, 2);

    const [batch] = spansNamed("TelemetryFanInWriter.insert MetricItemV2");
    const [submission] = spansNamed("TelemetryFanInWriter.submit MetricItemV2");

    expect(batch!.status.code).toBe(2);
    expect(submission!.status.code).toBe(2);
    expect(submission!.status.message).toContain("MetricItemV2");

    for (const span of [batch!, submission!]) {
      expect(
        span.events.some((event: { name: string }) => {
          return event.name === "exception";
        }),
      ).toBe(false);
    }
  });

  test("rows submitted outside every trace make no spans, and their insert runs in no trace", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(OPTIONS);
    const { target, inserts } = newTarget();

    const submission: FanInSubmitResult = await writer.submit(target, rows(2));
    await submission.flushed;

    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(inserts[0]!.activeSpan).toBeUndefined();
  });

  test("a deployment that exports no spans gets none", async () => {
    jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(false);
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(OPTIONS);
    const { target } = newTarget();

    await job("job A", writer, target, 2);

    expect(
      exporter.getFinishedSpans().map((span: ReadableSpan) => {
        return span.name;
      }),
    ).toEqual(["job A"]);
  });
});
