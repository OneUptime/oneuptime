import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { Context, Span, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { QueueJob, QueueName } from "../../../Server/Infrastructure/Queue";
import QueueWorker from "../../../Server/Infrastructure/QueueWorker";
import GracefulShutdown from "../../../Server/Utils/GracefulShutdown";
import Telemetry from "../../../Server/Utils/Telemetry";

/*
 * EVERY QUEUE JOB IS A TRACE OF ITS OWN.
 *
 * QueueWorker.getWorker runs inside its own span (@CaptureSpan), and BullMQ
 * starts the worker's fetch loop in its constructor - so the loop, and every
 * job it ran for the life of the process, carried that span's context. Every
 * job the worker ever ran became one trace rooted at a getWorker span that
 * ended at startup: OneUptime's own traces showed QueueWorker.getWorker with
 * hundreds of unrelated jobs under it, and its AI / LLM conversation view -
 * which groups a request's AI calls by trace - showed two investigations
 * running at once as one "request" of interleaved calls.
 *
 * These tests build a worker the way a process does, inside spans, and run
 * its jobs the way BullMQ does: from the context the worker was built in.
 */

interface MockWorker {
  processor: (job: QueueJob) => Promise<void>;
  // The OpenTelemetry context the worker was constructed in.
  builtIn: Context;
  on: jest.Mock;
  close: jest.Mock;
}

const mockWorkers: Array<MockWorker> = [];

jest.mock("bullmq", () => {
  const otel: typeof import("@opentelemetry/api") =
    jest.requireActual("@opentelemetry/api");

  class Queue {
    public add: jest.Mock = jest.fn();
  }

  class QueueEvents {
    public on: jest.Mock = jest.fn();
  }

  class Job {}

  return {
    __esModule: true,
    Queue,
    QueueEvents,
    Job,
    Worker: jest
      .fn()
      .mockImplementation(
        (_name: string, processor: (job: QueueJob) => Promise<void>) => {
          const worker: MockWorker = {
            processor: processor,
            builtIn: otel.context.active(),
            on: jest.fn(),
            close: jest.fn().mockResolvedValue(undefined),
          };
          mockWorkers.push(worker);
          return worker;
        },
      ),
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getRedisOptions: jest.fn().mockReturnValue({}) },
  };
});

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  const instrument: () => { add: jest.Mock; record: jest.Mock } = () => {
    return { add: jest.fn(), record: jest.fn() };
  };

  return {
    __esModule: true,
    default: {
      getWorkerJobsInFlight: instrument,
      getWorkerJobCounter: instrument,
      getWorkerJobDuration: instrument,
    },
  };
});

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

function job(name: string): QueueJob {
  return { id: `${name}-1`, name: name, data: {} } as unknown as QueueJob;
}

function spanNamed(name: string): ReadableSpan {
  const spans: Array<ReadableSpan> = exporter
    .getFinishedSpans()
    .filter((span: ReadableSpan) => {
      return span.name === name;
    });

  expect(spans).toHaveLength(1);

  return spans[0]!;
}

function traceIdOf(span: ReadableSpan): string {
  return span.spanContext().traceId;
}

/*
 * A worker built the way a process builds one: at startup, inside a span of
 * the process's own (and getWorker's own, from @CaptureSpan).
 */
function buildWorker(
  onJobInQueue: (job: QueueJob) => Promise<void>,
): MockWorker {
  trace.getTracer("test").startActiveSpan("startup", (span: Span) => {
    QueueWorker.getWorker(QueueName.Worker, onJobInQueue, { concurrency: 1 });
    span.end();
  });

  return mockWorkers[mockWorkers.length - 1]!;
}

// A job run the way BullMQ runs it: from the loop the constructor started.
function runAsBullMqDoes(
  worker: MockWorker,
  queueJob: QueueJob,
): Promise<void> {
  return context.with(worker.builtIn, () => {
    return worker.processor(queueJob);
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
  mockWorkers.length = 0;
  // A deployment that exports its own traces: @CaptureSpan opens spans.
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
  jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("QueueWorker jobs are traces of their own", () => {
  test("the worker is built outside every span", () => {
    const worker: MockWorker = buildWorker(async () => {});

    expect(trace.getSpan(worker.builtIn)).toBeUndefined();
    // getWorker itself is still traced, as a span of the startup.
    expect(traceIdOf(spanNamed("QueueWorker.getWorker"))).toBe(
      traceIdOf(spanNamed("startup")),
    );
  });

  test("a job is the root of a new trace, not a child of the span that built its worker", async () => {
    const worker: MockWorker = buildWorker(async () => {});

    await runAsBullMqDoes(worker, job("SendOwnerAddedEmail"));

    const jobSpan: ReadableSpan = spanNamed(
      `worker.job ${QueueName.Worker}/SendOwnerAddedEmail`,
    );

    expect(jobSpan.parentSpanContext).toBeUndefined();
    expect(traceIdOf(jobSpan)).not.toBe(
      traceIdOf(spanNamed("QueueWorker.getWorker")),
    );
    expect(traceIdOf(jobSpan)).not.toBe(traceIdOf(spanNamed("startup")));
  });

  test("two jobs of one worker are two traces", async () => {
    const worker: MockWorker = buildWorker(async () => {});

    await runAsBullMqDoes(worker, job("RunInvestigation"));
    await runAsBullMqDoes(worker, job("SendUnresolvedReminder"));

    const first: ReadableSpan = spanNamed(
      `worker.job ${QueueName.Worker}/RunInvestigation`,
    );
    const second: ReadableSpan = spanNamed(
      `worker.job ${QueueName.Worker}/SendUnresolvedReminder`,
    );

    expect(traceIdOf(first)).not.toBe(traceIdOf(second));
  });

  test("two jobs running at once are two traces", async () => {
    let release: () => void = () => {};
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });
    const worker: MockWorker = buildWorker(async () => {
      await gate;
    });

    const running: Array<Promise<void>> = [
      runAsBullMqDoes(worker, job("InvestigateIncident42")),
      runAsBullMqDoes(worker, job("InvestigateIncident43")),
    ];

    release();
    await Promise.all(running);

    expect(
      traceIdOf(
        spanNamed(`worker.job ${QueueName.Worker}/InvestigateIncident42`),
      ),
    ).not.toBe(
      traceIdOf(
        spanNamed(`worker.job ${QueueName.Worker}/InvestigateIncident43`),
      ),
    );
  });

  test("a job is a new trace even when it is run from inside another span", async () => {
    const worker: MockWorker = buildWorker(async () => {});

    await trace
      .getTracer("test")
      .startActiveSpan("someone else's span", async (span: Span) => {
        await worker.processor(job("Cleanup"));
        span.end();
      });

    const jobSpan: ReadableSpan = spanNamed(
      `worker.job ${QueueName.Worker}/Cleanup`,
    );

    expect(jobSpan.parentSpanContext).toBeUndefined();
    expect(traceIdOf(jobSpan)).not.toBe(
      traceIdOf(spanNamed("someone else's span")),
    );
  });

  test("what a job does is part of the job's trace", async () => {
    const worker: MockWorker = buildWorker(async () => {
      trace.getTracer("test").startActiveSpan("work", (span: Span) => {
        span.end();
      });
    });

    await runAsBullMqDoes(worker, job("RunInvestigation"));

    const jobSpan: ReadableSpan = spanNamed(
      `worker.job ${QueueName.Worker}/RunInvestigation`,
    );
    const work: ReadableSpan = spanNamed("work");

    expect(traceIdOf(work)).toBe(traceIdOf(jobSpan));
    expect(work.parentSpanContext?.spanId).toBe(jobSpan.spanContext().spanId);
  });

  test("a job that fails is still a trace of its own, marked failed", async () => {
    const worker: MockWorker = buildWorker(async () => {
      throw new Error("payments-db is down");
    });

    await expect(runAsBullMqDoes(worker, job("Charge"))).rejects.toThrow(
      "payments-db is down",
    );

    const jobSpan: ReadableSpan = spanNamed(
      `worker.job ${QueueName.Worker}/Charge`,
    );

    expect(jobSpan.parentSpanContext).toBeUndefined();
    expect(jobSpan.status.code).toBe(2);
  });
});
