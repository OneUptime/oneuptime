import type {
  Attributes,
  BatchObservableCallback,
  Context,
  Counter,
  Gauge,
  Histogram,
  Meter,
  MeterOptions,
  MeterProvider,
  MetricOptions,
  Observable,
  ObservableCounter,
  ObservableGauge,
  ObservableUpDownCounter,
  UpDownCounter,
} from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  BufferConfig,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import Dictionary from "../../../Types/Dictionary";
import logger from "../Logger";

/*
 * The queue between OneUptime's own spans and its OTLP span exporter.
 *
 * The SDK's BatchSpanProcessor holds at most 2,048 finished spans, sends 512
 * at a time with one export in flight, every 5 s - and drops every span that
 * ends while its queue is full, silently: the warning it writes goes to the
 * OpenTelemetry diag logger, which OneUptime does not install. A worker job
 * ends 1,000-3,000 spans within a few hundred milliseconds, several jobs run
 * at once, and on test.oneuptime.com (2026-10-27, 05:15-05:45 UTC) a 1%
 * sample held 2,363-2,732 spans a quarter-hour whose parent never arrived:
 * worker job traces of thousands of spans with no root, because a job's root
 * span ends last, when the queue is fullest.
 *
 * So the limits are set here, well above the SDK's, each one readable from
 * OpenTelemetry's own variable and held to bounds:
 *
 *   OTEL_BSP_MAX_QUEUE_SIZE          finished spans held   (32,768)
 *   OTEL_BSP_MAX_EXPORT_BATCH_SIZE   spans per export      (2,048)
 *   OTEL_BSP_SCHEDULE_DELAY          ms between exports    (1,000)
 *   OTEL_BSP_EXPORT_TIMEOUT          ms an export may take (30,000)
 *
 * (the Helm chart sets them through each component's extraEnv). A full queue
 * at the default holds tens of megabytes; the processes run with gigabytes.
 *
 * And a drop is no longer silent. It is counted where the SDK counts it, in
 * its own self-observability metric otel.sdk.processor.span.processed with
 * error.type "queue_full", next to otel.sdk.processor.span.queue.size and
 * .capacity, and it is logged - once per DROP_REPORT_INTERVAL_MS at most,
 * with how many spans were lost.
 */

export interface SpanExportLimits {
  maxQueueSize: number;
  maxExportBatchSize: number;
  scheduledDelayMillis: number;
  exportTimeoutMillis: number;
}

interface Bound {
  envVariable: string;
  defaultValue: number;
  min: number;
  max: number;
}

export const SPAN_EXPORT_LIMIT_BOUNDS: Record<keyof SpanExportLimits, Bound> = {
  maxQueueSize: {
    envVariable: "OTEL_BSP_MAX_QUEUE_SIZE",
    defaultValue: 32_768,
    // Never below the SDK's own default.
    min: 2_048,
    max: 262_144,
  },
  maxExportBatchSize: {
    envVariable: "OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
    defaultValue: 2_048,
    min: 64,
    max: 16_384,
  },
  scheduledDelayMillis: {
    envVariable: "OTEL_BSP_SCHEDULE_DELAY",
    defaultValue: 1_000,
    min: 100,
    max: 60_000,
  },
  exportTimeoutMillis: {
    envVariable: "OTEL_BSP_EXPORT_TIMEOUT",
    defaultValue: 30_000,
    min: 1_000,
    max: 300_000,
  },
};

// How often, at most, dropped spans are logged.
export const DROP_REPORT_INTERVAL_MS: number = 10_000;

// The SDK's own counter of finished spans, failed and dropped ones included.
export const PROCESSED_SPANS_METRIC: string =
  "otel.sdk.processor.span.processed";
const QUEUE_FULL: string = "queue_full";

function readBoundedInteger(
  env: Dictionary<string | undefined>,
  bound: Bound,
): number {
  const raw: string | undefined = env[bound.envVariable]?.trim();

  if (!raw) {
    return bound.defaultValue;
  }

  const value: number = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    return bound.defaultValue;
  }

  return Math.min(bound.max, Math.max(bound.min, Math.floor(value)));
}

// The limits a process exports its spans with: OTEL_BSP_*, else OneUptime's.
export function getSpanExportLimits(
  env: Dictionary<string | undefined>,
): SpanExportLimits {
  const maxQueueSize: number = readBoundedInteger(
    env,
    SPAN_EXPORT_LIMIT_BOUNDS.maxQueueSize,
  );

  return {
    maxQueueSize: maxQueueSize,
    // The SDK lowers a batch larger than the queue itself, with a warning.
    maxExportBatchSize: Math.min(
      maxQueueSize,
      readBoundedInteger(env, SPAN_EXPORT_LIMIT_BOUNDS.maxExportBatchSize),
    ),
    scheduledDelayMillis: readBoundedInteger(
      env,
      SPAN_EXPORT_LIMIT_BOUNDS.scheduledDelayMillis,
    ),
    exportTimeoutMillis: readBoundedInteger(
      env,
      SPAN_EXPORT_LIMIT_BOUNDS.exportTimeoutMillis,
    ),
  };
}

/*
 * Collects dropped spans and logs them as one line per interval, so a queue
 * that stays full cannot flood the log. The timer is unref'd: it never keeps
 * a process alive.
 */
export class SpanDropReporter {
  private pending: number = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    private readonly options: {
      maxQueueSize: number;
      intervalInMs?: number | undefined;
      log?: ((message: string) => void) | undefined;
    },
  ) {}

  public record(count: number): void {
    if (!Number.isFinite(count) || count <= 0) {
      return;
    }

    this.pending += count;

    if (this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, this.options.intervalInMs ?? DROP_REPORT_INTERVAL_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  public flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pending === 0) {
      return;
    }

    const dropped: number = this.pending;
    this.pending = 0;

    const seconds: number = Math.round(
      (this.options.intervalInMs ?? DROP_REPORT_INTERVAL_MS) / 1000,
    );
    const message: string = `OpenTelemetry dropped ${dropped} span(s) in the last ${seconds} s: the span export queue (${this.options.maxQueueSize} spans) was full, so their traces are missing those spans. Raise OTEL_BSP_MAX_QUEUE_SIZE, or find what is making that many spans.`;

    try {
      (
        this.options.log ??
        ((text: string): void => {
          logger.warn(text);
        })
      )(message);
    } catch {
      // Reporting a loss must never break span processing.
    }
  }
}

/*
 * The meter provider handed to the SDK's processor for its self-observability
 * metrics, with one addition: every add to its processed-spans counter that
 * carries error.type "queue_full" is also told to `onDropped`. Everything
 * else is the wrapped provider's own.
 */
export function watchDroppedSpans(
  meterProvider: MeterProvider,
  onDropped: (count: number) => void,
): MeterProvider {
  return {
    getMeter(name: string, version?: string, options?: MeterOptions): Meter {
      const meter: Meter = meterProvider.getMeter(name, version, options);

      return {
        createCounter<AttributesTypes extends Attributes = Attributes>(
          counterName: string,
          counterOptions?: MetricOptions,
        ): Counter<AttributesTypes> {
          const counter: Counter<AttributesTypes> =
            meter.createCounter<AttributesTypes>(counterName, counterOptions);

          if (counterName !== PROCESSED_SPANS_METRIC) {
            return counter;
          }

          return {
            add(
              value: number,
              attributes?: AttributesTypes,
              context?: Context,
            ): void {
              counter.add(value, attributes, context);

              if (attributes?.["error.type"] === QUEUE_FULL) {
                onDropped(value);
              }
            },
          };
        },
        createGauge<AttributesTypes extends Attributes = Attributes>(
          gaugeName: string,
          gaugeOptions?: MetricOptions,
        ): Gauge<AttributesTypes> {
          return meter.createGauge<AttributesTypes>(gaugeName, gaugeOptions);
        },
        createHistogram<AttributesTypes extends Attributes = Attributes>(
          histogramName: string,
          histogramOptions?: MetricOptions,
        ): Histogram<AttributesTypes> {
          return meter.createHistogram<AttributesTypes>(
            histogramName,
            histogramOptions,
          );
        },
        createUpDownCounter<AttributesTypes extends Attributes = Attributes>(
          counterName: string,
          counterOptions?: MetricOptions,
        ): UpDownCounter<AttributesTypes> {
          return meter.createUpDownCounter<AttributesTypes>(
            counterName,
            counterOptions,
          );
        },
        createObservableGauge<AttributesTypes extends Attributes = Attributes>(
          gaugeName: string,
          gaugeOptions?: MetricOptions,
        ): ObservableGauge<AttributesTypes> {
          return meter.createObservableGauge<AttributesTypes>(
            gaugeName,
            gaugeOptions,
          );
        },
        createObservableCounter<
          AttributesTypes extends Attributes = Attributes,
        >(
          counterName: string,
          counterOptions?: MetricOptions,
        ): ObservableCounter<AttributesTypes> {
          return meter.createObservableCounter<AttributesTypes>(
            counterName,
            counterOptions,
          );
        },
        createObservableUpDownCounter<
          AttributesTypes extends Attributes = Attributes,
        >(
          counterName: string,
          counterOptions?: MetricOptions,
        ): ObservableUpDownCounter<AttributesTypes> {
          return meter.createObservableUpDownCounter<AttributesTypes>(
            counterName,
            counterOptions,
          );
        },
        addBatchObservableCallback<
          AttributesTypes extends Attributes = Attributes,
        >(
          callback: BatchObservableCallback<AttributesTypes>,
          observables: Array<Observable<AttributesTypes>>,
        ): void {
          meter.addBatchObservableCallback<AttributesTypes>(
            callback,
            observables,
          );
        },
        removeBatchObservableCallback<
          AttributesTypes extends Attributes = Attributes,
        >(
          callback: BatchObservableCallback<AttributesTypes>,
          observables: Array<Observable<AttributesTypes>>,
        ): void {
          meter.removeBatchObservableCallback<AttributesTypes>(
            callback,
            observables,
          );
        },
      };
    },
  };
}

/*
 * The BatchSpanProcessor Telemetry.init exports spans through: the limits
 * above, and drops counted on `meterProvider` and logged by a reporter.
 */
export function createSpanExportProcessor(data: {
  exporter: SpanExporter;
  meterProvider: MeterProvider;
  env?: Dictionary<string | undefined> | undefined;
  reporter?: SpanDropReporter | undefined;
}): BatchSpanProcessor {
  const limits: SpanExportLimits = getSpanExportLimits(data.env ?? process.env);
  const reporter: SpanDropReporter =
    data.reporter ??
    new SpanDropReporter({ maxQueueSize: limits.maxQueueSize });

  /*
   * selfObsMeterProvider is the SDK's own (experimental) option for these
   * metrics; sdk-trace-base's BufferConfig does not declare it yet, but
   * passes it through. SpanExportQueue.test.ts fails if a drop ever stops
   * reaching the reporter.
   */
  const config: BufferConfig & { selfObsMeterProvider: MeterProvider } = {
    ...limits,
    selfObsMeterProvider: watchDroppedSpans(
      data.meterProvider,
      (count: number): void => {
        reporter.record(count);
      },
    ),
  };

  return new BatchSpanProcessor(data.exporter, config);
}
