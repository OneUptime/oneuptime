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
import { Link, Span, context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import Queue, {
  QueueJob,
  QueueName,
} from "../../../Server/Infrastructure/Queue";
import QueueWorker from "../../../Server/Infrastructure/QueueWorker";
import GracefulShutdown from "../../../Server/Utils/GracefulShutdown";
import Telemetry from "../../../Server/Utils/Telemetry";
import QueueJobTraceContext, {
  JOB_TRACE_CONTEXT_KEY,
} from "../../../Server/Utils/Telemetry/QueueJobTraceContext";
import { JSONObject } from "../../../Types/JSON";

/*
 * A QUEUE JOB LINKS TO THE REQUEST THAT ENQUEUED IT.
 *
 * Every job is the root of a trace of its own, so nothing tied a telemetry
 * job's 3,000 spans to the ingest request that enqueued it, or a sent email
 * to the API call that asked for it. Now Queue.addJob writes its span's
 * context into the job's data and QueueWorker takes it out again - before
 * the handler sees the job - and links the job's root span to it.
 */

jest.mock("../../../Server/Utils/Logger");

interface MockWorker {
  processor: (job: QueueJob) => Promise<void>;
}

const mockWorkers: Array<MockWorker> = [];
const mockAdded: Array<{ name: string; data: JSONObject }> = [];

jest.mock("bullmq", () => {
  class Queue {
    public client: Promise<{ on: () => void }> = Promise.resolve({
      on: (): void => {},
    });

    public add(
      name: string,
      data: JSONObject,
    ): Promise<Record<string, unknown>> {
      mockAdded.push({ name, data });
      return Promise.resolve({});
    }

    public getRepeatableJobs(): Promise<Array<unknown>> {
      return Promise.resolve([]);
    }

    public removeRepeatableByKey(): Promise<boolean> {
      return Promise.resolve(true);
    }

    public getJob(): Promise<undefined> {
      return Promise.resolve(undefined);
    }

    public clean(): Promise<Array<string>> {
      return Promise.resolve([]);
    }
  }

  return {
    __esModule: true,
    Queue,
    QueueEvents: class {
      public on(): void {}
    },
    Job: class {},
    Worker: class {
      public constructor(
        _name: string,
        processor: (job: QueueJob) => Promise<void>,
      ) {
        mockWorkers.push({ processor });
      }

      public on(): void {}

      public close(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  const instrument: () => { add: () => void; record: () => void } = () => {
    return { add: (): void => {}, record: (): void => {} };
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

function spanNamed(name: string): ReadableSpan {
  const spans: Array<ReadableSpan> = exporter
    .getFinishedSpans()
    .filter((span: ReadableSpan) => {
      return span.name === name;
    });
  expect(spans).toHaveLength(1);
  return spans[0]!;
}

async function inRequest(work: () => Promise<void>): Promise<void> {
  await trace
    .getTracer("test")
    .startActiveSpan("request", async (span: Span): Promise<void> => {
      try {
        await work();
      } finally {
        span.end();
      }
    });
}

beforeAll(() => {
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
  // What Telemetry.init's NodeSDK registers in a running process.
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});

afterAll(() => {
  propagation.disable();
  trace.disable();
  context.disable();
});

beforeEach(() => {
  exporter.reset();
  mockAdded.length = 0;
  mockWorkers.length = 0;
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
  jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("QueueJobTraceContext", () => {
  test("job data enqueued inside a span carries that span's context, in a copy", async () => {
    const data: JSONObject = { projectId: "p-1" };
    let carried: JSONObject = {};
    let spanId: string = "";

    await inRequest(async () => {
      spanId = trace.getActiveSpan()!.spanContext().spanId;
      carried = QueueJobTraceContext.addToJobData(data);
    });

    expect(data).toEqual({ projectId: "p-1" });
    expect(carried["projectId"]).toBe("p-1");
    expect(
      (carried[JOB_TRACE_CONTEXT_KEY] as JSONObject)["traceparent"],
    ).toContain(spanId);
  });

  test("job data enqueued outside every span, or with no spans exported, is left as it is", async () => {
    const data: JSONObject = { projectId: "p-1" };

    expect(QueueJobTraceContext.addToJobData(data)).toBe(data);

    jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(false);

    await inRequest(async () => {
      expect(QueueJobTraceContext.addToJobData(data)).toBe(data);
    });
  });

  test("taking the context out leaves the data as it was enqueued, and links to the span", async () => {
    let carried: JSONObject = {};
    let spanId: string = "";

    await inRequest(async () => {
      spanId = trace.getActiveSpan()!.spanContext().spanId;
      carried = QueueJobTraceContext.addToJobData({ projectId: "p-1" });
    });

    const link: Link | null = QueueJobTraceContext.takeFromJobData(carried);

    expect(carried).toEqual({ projectId: "p-1" });
    expect(link?.context.spanId).toBe(spanId);
  });

  test("a carrier nobody can read is taken out and links nowhere", () => {
    const garbled: JSONObject = {
      projectId: "p-1",
      [JOB_TRACE_CONTEXT_KEY]: { traceparent: "not-a-traceparent" },
    };
    const notAnObject: JSONObject = {
      projectId: "p-1",
      [JOB_TRACE_CONTEXT_KEY]: "00-abc",
    };

    expect(QueueJobTraceContext.takeFromJobData(garbled)).toBeNull();
    expect(garbled).toEqual({ projectId: "p-1" });
    expect(QueueJobTraceContext.takeFromJobData(notAnObject)).toBeNull();
    expect(notAnObject).toEqual({ projectId: "p-1" });
    expect(QueueJobTraceContext.takeFromJobData({ a: 1 })).toBeNull();
    expect(QueueJobTraceContext.takeFromJobData(null)).toBeNull();
    expect(QueueJobTraceContext.takeFromJobData("data")).toBeNull();
  });
});

describe("A job links to the request that enqueued it", () => {
  test("Queue.addJob sends the context along, and the worker links the job to it", async () => {
    const data: JSONObject = { projectId: "p-1", userId: "u-1" };

    await inRequest(async () => {
      await Queue.addJob(QueueName.Worker, "job-1", "SendEmail", data);
    });

    expect(mockAdded).toHaveLength(1);
    expect(mockAdded[0]!.data[JOB_TRACE_CONTEXT_KEY]).toBeDefined();
    // The caller's object is untouched.
    expect(data).toEqual({ projectId: "p-1", userId: "u-1" });

    const handled: Array<JSONObject> = [];

    QueueWorker.getWorker(
      QueueName.Worker,
      async (job: QueueJob): Promise<void> => {
        handled.push({ ...(job.data as JSONObject) });
      },
      { concurrency: 1 },
    );

    await mockWorkers[0]!.processor({
      id: "job-1",
      name: "SendEmail",
      data: mockAdded[0]!.data,
    } as unknown as QueueJob);

    // The handler sees the data as it was enqueued.
    expect(handled).toEqual([{ projectId: "p-1", userId: "u-1" }]);

    const enqueue: ReadableSpan = spanNamed("Queue.addJob");
    const request: ReadableSpan = spanNamed("request");
    const jobSpan: ReadableSpan = spanNamed(
      `worker.job ${QueueName.Worker}/SendEmail`,
    );

    // Still a trace of its own, linked to where it was enqueued.
    expect(jobSpan.parentSpanContext).toBeUndefined();
    expect(jobSpan.spanContext().traceId).not.toBe(
      request.spanContext().traceId,
    );
    expect(jobSpan.links).toHaveLength(1);
    expect(jobSpan.links[0]!.context.spanId).toBe(enqueue.spanContext().spanId);
    expect(jobSpan.links[0]!.context.traceId).toBe(
      request.spanContext().traceId,
    );
  });

  test("a repeatable job carries no context: every run would link to its registration", async () => {
    await inRequest(async () => {
      await Queue.addJob(
        QueueName.Worker,
        "cron-1",
        "HourlyCleanup",
        { a: 1 },
        { scheduleAt: "0 * * * *" },
      );
    });

    expect(mockAdded[0]!.data).toEqual({ a: 1 });
  });

  test("a job enqueued outside every request links to the enqueue's own span", async () => {
    // Queue.addJob is a span of its own (@CaptureSpan), the root of its trace.
    await Queue.addJob(QueueName.Worker, "job-2", "SendEmail", { a: 1 });

    QueueWorker.getWorker(QueueName.Worker, async (): Promise<void> => {}, {
      concurrency: 1,
    });

    await mockWorkers[0]!.processor({
      id: "job-2",
      name: "SendEmail",
      data: mockAdded[0]!.data,
    } as unknown as QueueJob);

    const enqueue: ReadableSpan = spanNamed("Queue.addJob");
    const jobSpan: ReadableSpan = spanNamed(
      `worker.job ${QueueName.Worker}/SendEmail`,
    );

    expect(enqueue.parentSpanContext).toBeUndefined();
    expect(jobSpan.links).toHaveLength(1);
    expect(jobSpan.links[0]!.context.spanId).toBe(enqueue.spanContext().spanId);
  });

  test("a job whose data carries no context is a root with no link", async () => {
    QueueWorker.getWorker(QueueName.Worker, async (): Promise<void> => {}, {
      concurrency: 1,
    });

    // Enqueued by a process that exports no spans, or before this change.
    await mockWorkers[0]!.processor({
      id: "job-3",
      name: "SendEmail",
      data: { a: 1 },
    } as unknown as QueueJob);

    expect(
      spanNamed(`worker.job ${QueueName.Worker}/SendEmail`).links,
    ).toHaveLength(0);
  });
});
