import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Tracer } from "@opentelemetry/api";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import {
  DataPoint,
  MeterProvider,
  MetricReader,
  ResourceMetrics,
  SumMetricData,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  BufferConfig,
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import fs from "fs";
import path from "path";
import {
  PROCESSED_SPANS_METRIC,
  SpanDropReporter,
  SpanExportLimits,
  createSpanExportProcessor,
  getSpanExportLimits,
  watchDroppedSpans,
} from "../../../../Server/Utils/Telemetry/SpanExportQueue";

/*
 * THE SPAN EXPORT QUEUE NO LONGER LOSES A JOB'S SPANS WITHOUT A WORD.
 *
 * Telemetry.init exported OneUptime's own spans through the SDK's default
 * BatchSpanProcessor: 2,048 spans queued, 512 sent at a time, one export in
 * flight. A worker job ends 1,000-3,000 spans in a few hundred milliseconds,
 * and on test.oneuptime.com (2026-10-27, 05:15-05:45 UTC) traces of 3,000
 * spans arrived with no root and half their spans orphaned: the queue was
 * full when they ended, and the SDK dropped them silently.
 *
 * Spans here end into a processor whose exporter does not answer - an export
 * still in flight, as when the collector is slow - so the queue fills the
 * way it did in production.
 */

jest.mock("../../../../Server/Utils/Logger");

// An exporter whose exports wait until released, then answer at once.
class SlowExporter implements SpanExporter {
  public exported: number = 0;
  private pending: Array<(result: ExportResult) => void> = [];
  private released: boolean = false;

  public export(
    spans: Array<ReadableSpan>,
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.exported += spans.length;

    if (this.released) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    this.pending.push(resultCallback);
  }

  public release(): void {
    this.released = true;
    for (const answer of this.pending.splice(0)) {
      answer({ code: ExportResultCode.SUCCESS });
    }
  }

  public shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

class CollectingReader extends MetricReader {
  protected override async onForceFlush(): Promise<void> {
    // Nothing is pushed anywhere: the test collects.
  }

  protected override async onShutdown(): Promise<void> {
    // Nothing to release.
  }
}

interface Harness {
  exporter: SlowExporter;
  processor: BatchSpanProcessor;
  tracer: Tracer;
  reader: CollectingReader;
  logged: Array<string>;
  reporter: SpanDropReporter;
}

const harnesses: Array<Harness> = [];

function harness(
  env: Record<string, string>,
  build?: (
    exporter: SlowExporter,
    reader: CollectingReader,
  ) => BatchSpanProcessor,
): Harness {
  const exporter: SlowExporter = new SlowExporter();
  const reader: CollectingReader = new CollectingReader();
  const logged: Array<string> = [];
  const limits: SpanExportLimits = getSpanExportLimits(env);
  const reporter: SpanDropReporter = new SpanDropReporter({
    maxQueueSize: limits.maxQueueSize,
    intervalInMs: 60_000,
    log: (message: string): void => {
      logged.push(message);
    },
  });
  const processor: BatchSpanProcessor = build
    ? build(exporter, reader)
    : createSpanExportProcessor({
        exporter: exporter,
        meterProvider: new MeterProvider({ readers: [reader] }),
        env: env,
        reporter: reporter,
      });
  const tracer: Tracer = new BasicTracerProvider({
    spanProcessors: [processor],
  }).getTracer("worker-job");

  const built: Harness = {
    exporter,
    processor,
    tracer,
    reader,
    logged,
    reporter,
  };
  harnesses.push(built);
  return built;
}

// A worker job's burst: `count` spans ending one after another.
function endSpans(tracer: Tracer, count: number): void {
  for (let index: number = 0; index < count; index++) {
    tracer.startSpan(`DatabaseService.findOneBy ${index}`).end();
  }
}

async function droppedPerMetric(reader: CollectingReader): Promise<number> {
  const { resourceMetrics } = (await reader.collect()) as {
    resourceMetrics: ResourceMetrics;
  };
  let dropped: number = 0;

  for (const scope of resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor.name !== PROCESSED_SPANS_METRIC) {
        continue;
      }
      for (const point of (metric as SumMetricData).dataPoints as Array<
        DataPoint<number>
      >) {
        if (point.attributes["error.type"] === "queue_full") {
          dropped += point.value;
        }
      }
    }
  }

  return dropped;
}

afterEach(async () => {
  for (const built of harnesses.splice(0)) {
    built.reporter.flush();
    built.exporter.release();
    await built.processor.shutdown();
  }
});

describe("getSpanExportLimits", () => {
  test("OneUptime's limits, well above the SDK's, when nothing is set", () => {
    expect(getSpanExportLimits({})).toEqual({
      maxQueueSize: 32_768,
      maxExportBatchSize: 2_048,
      scheduledDelayMillis: 1_000,
      exportTimeoutMillis: 30_000,
    });
  });

  test("OpenTelemetry's own variables override them", () => {
    expect(
      getSpanExportLimits({
        OTEL_BSP_MAX_QUEUE_SIZE: "65536",
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "4096",
        OTEL_BSP_SCHEDULE_DELAY: "500",
        OTEL_BSP_EXPORT_TIMEOUT: "10000",
      }),
    ).toEqual({
      maxQueueSize: 65_536,
      maxExportBatchSize: 4_096,
      scheduledDelayMillis: 500,
      exportTimeoutMillis: 10_000,
    });
  });

  test("a value out of bounds is held to them", () => {
    expect(
      getSpanExportLimits({
        OTEL_BSP_MAX_QUEUE_SIZE: "10",
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "1000000",
        OTEL_BSP_SCHEDULE_DELAY: "1",
        OTEL_BSP_EXPORT_TIMEOUT: "999999999",
      }),
    ).toEqual({
      // Never below the SDK's own queue.
      maxQueueSize: 2_048,
      // Never above the queue.
      maxExportBatchSize: 2_048,
      scheduledDelayMillis: 100,
      exportTimeoutMillis: 300_000,
    });
    expect(
      getSpanExportLimits({ OTEL_BSP_MAX_QUEUE_SIZE: "100000000" })
        .maxQueueSize,
    ).toBe(262_144);
  });

  test("a value that is not a positive number is the default", () => {
    for (const value of ["", "  ", "lots", "-5", "0", "NaN", "Infinity"]) {
      expect(
        getSpanExportLimits({ OTEL_BSP_MAX_QUEUE_SIZE: value }).maxQueueSize,
      ).toBe(32_768);
    }
    expect(
      getSpanExportLimits({ OTEL_BSP_SCHEDULE_DELAY: "250.9" })
        .scheduledDelayMillis,
    ).toBe(250);
  });
});

describe("the span export queue", () => {
  test("a worker job's 3,000 spans fit, where the SDK's defaults dropped 440 of them", async () => {
    // The processor Telemetry.init used to build, its drops counted too.
    const before: Harness = harness(
      {},
      (exporter: SlowExporter, reader: CollectingReader) => {
        const sdkDefaults: BufferConfig & {
          selfObsMeterProvider: MeterProvider;
        } = { selfObsMeterProvider: new MeterProvider({ readers: [reader] }) };
        return new BatchSpanProcessor(exporter, sdkDefaults);
      },
    );
    const after: Harness = harness({});

    endSpans(before.tracer, 3_000);
    endSpans(after.tracer, 3_000);

    // SDK defaults: 512 in the export in flight, 2,048 queued, the rest lost.
    expect(before.exporter.exported).toBe(512);
    expect(await droppedPerMetric(before.reader)).toBe(440);

    // OneUptime's: 2,048 in flight, 952 queued, nothing lost.
    expect(after.exporter.exported).toBe(2_048);
    expect(await droppedPerMetric(after.reader)).toBe(0);
    after.reporter.flush();
    expect(after.logged).toEqual([]);
  });

  test("a span that ends on a full queue is counted and logged, never lost silently", async () => {
    const built: Harness = harness({
      OTEL_BSP_MAX_QUEUE_SIZE: "2048",
      OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "64",
      OTEL_BSP_SCHEDULE_DELAY: "60000",
      OTEL_BSP_EXPORT_TIMEOUT: "60000",
    });

    // 64 go into the export in flight, 2,048 fill the queue, 100 are lost.
    endSpans(built.tracer, 64 + 2_048 + 100);

    expect(built.exporter.exported).toBe(64);
    expect(await droppedPerMetric(built.reader)).toBe(100);

    built.reporter.flush();

    expect(built.logged).toHaveLength(1);
    expect(built.logged[0]).toContain("dropped 100 span(s)");
    expect(built.logged[0]).toContain("(2048 spans)");
    expect(built.logged[0]).toContain("OTEL_BSP_MAX_QUEUE_SIZE");
  });

  test("Telemetry.init exports through this queue, not the SDK's default one", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../../Server/Utils/Telemetry.ts"),
      "utf8",
    );

    expect(source).toContain("createSpanExportProcessor(");
    expect(source).not.toContain("new BatchSpanProcessor(");
  });
});

describe("SpanDropReporter", () => {
  test("drops within an interval are one line with their total", () => {
    jest.useFakeTimers();

    try {
      const logged: Array<string> = [];
      const reporter: SpanDropReporter = new SpanDropReporter({
        maxQueueSize: 32_768,
        intervalInMs: 10_000,
        log: (message: string): void => {
          logged.push(message);
        },
      });

      reporter.record(3);
      reporter.record(4);
      jest.advanceTimersByTime(9_999);
      expect(logged).toHaveLength(0);

      jest.advanceTimersByTime(1);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain("dropped 7 span(s) in the last 10 s");

      reporter.record(1);
      jest.advanceTimersByTime(10_000);
      expect(logged).toHaveLength(2);
      expect(logged[1]).toContain("dropped 1 span(s)");

      // Nothing dropped, nothing logged.
      jest.advanceTimersByTime(60_000);
      expect(logged).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a log that fails does not reach the span path", () => {
    const reporter: SpanDropReporter = new SpanDropReporter({
      maxQueueSize: 2_048,
      log: (): void => {
        throw new Error("log transport down");
      },
    });

    reporter.record(5);

    expect(() => {
      reporter.flush();
    }).not.toThrow();
  });
});

describe("watchDroppedSpans", () => {
  test("only the processed counter's queue_full adds are drops; every instrument still records", async () => {
    const reader: CollectingReader = new CollectingReader();
    const dropped: Array<number> = [];
    const watched: ReturnType<typeof watchDroppedSpans> = watchDroppedSpans(
      new MeterProvider({ readers: [reader] }),
      (count: number): void => {
        dropped.push(count);
      },
    );
    const meter: ReturnType<(typeof watched)["getMeter"]> = watched.getMeter(
      "@opentelemetry/sdk-trace",
    );

    meter.createCounter(PROCESSED_SPANS_METRIC).add(5, {});
    meter
      .createCounter(PROCESSED_SPANS_METRIC)
      .add(2, { "error.type": "queue_full" });
    meter
      .createCounter(PROCESSED_SPANS_METRIC)
      .add(1, { "error.type": "OTLPExporterError" });
    meter.createCounter("another.counter").add(9, {
      "error.type": "queue_full",
    });
    meter.createUpDownCounter("otel.sdk.processor.span.queue.capacity").add(7);

    expect(dropped).toEqual([2]);

    const { resourceMetrics } = (await reader.collect()) as {
      resourceMetrics: ResourceMetrics;
    };
    const names: Array<string> = resourceMetrics.scopeMetrics.flatMap(
      (scope: ResourceMetrics["scopeMetrics"][number]) => {
        return scope.metrics.map((metric: { descriptor: { name: string } }) => {
          return metric.descriptor.name;
        });
      },
    );

    expect(names.sort()).toEqual([
      "another.counter",
      PROCESSED_SPANS_METRIC,
      "otel.sdk.processor.span.queue.capacity",
    ]);
  });
});
