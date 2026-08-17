import { describe, expect, test, afterAll, beforeAll } from "@jest/globals";
import path from "path";
import protobuf from "protobufjs";
import { Worker } from "worker_threads";
import { TelemetryDecodeThreadPool } from "../../FeatureSet/Telemetry/Utils/DecodeThreadPool";
import OtelDecode, {
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelDecode";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

/*
 * Pool mechanics with REAL worker threads: scheduling (one in-flight
 * per thread, FIFO admission), id correlation under interleaving,
 * per-request error propagation, thread-death recovery, the unhealthy
 * breaker, source-Buffer safety, and shutdown.
 *
 * Thread budget: spawning a ts-node worker costs real seconds, so this
 * file reuses ONE shared size-2 pool for the concurrency/correctness
 * tests and spins up two deliberately tiny (size-1) pools only where a
 * test must kill or wedge a specific thread. Pool sizes are hard-capped
 * at 2 throughout.
 */

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

const LogsDataType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "logs.proto"))
  .lookupType("LogsData");

/*
 * Distinct payload per request: the log body carries the marker, so a
 * cross-wired response (an id-correlation bug) would surface as the
 * WRONG marker coming back for a request — which is exactly what the
 * concurrency test asserts against.
 */
function makeLogsPayload(marker: string): JSONObject {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: `svc-${marker}` } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: "pool-test" },
            logRecords: [
              {
                timeUnixNano: "1700000000000000000",
                severityText: "INFO",
                body: { stringValue: `payload-${marker}` },
              },
            ],
          },
        ],
      },
    ],
  };
}

/*
 * A payload big enough that its decode is reliably still in flight when
 * the test terminates the worker one synchronous statement later.
 */
function makeLargeLogsPayload(recordCount: number): JSONObject {
  const logRecords: Array<JSONObject> = [];
  for (let i: number = 0; i < recordCount; i++) {
    logRecords.push({
      timeUnixNano: "1700000000000000000",
      severityText: "INFO",
      body: { stringValue: `bulk log line ${i} ${"x".repeat(120)}` },
    });
  }
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "bulk-service" } },
          ],
        },
        scopeLogs: [{ scope: { name: "bulk" }, logRecords: logRecords }],
      },
    ],
  };
}

function encodeLogs(payload: JSONObject): Buffer {
  const message: protobuf.Message<Record<string, unknown>> =
    LogsDataType.fromObject(payload);
  return Buffer.from(LogsDataType.encode(message).finish());
}

/*
 * Race a decode promise against a short timer: resolves to the
 * rejection Error if the promise rejected, "resolved" if it fulfilled,
 * or "pending" if it settled neither way within timeoutMs. A
 * still-pending promise is the hung-job failure mode the shutdown/
 * breaker tests below exist to rule out — every outstanding decode must
 * SETTLE when the pool shuts down or trips its breaker, or the owning
 * BullMQ job would hang until its lock timeout.
 */
function settlementWithin(
  promise: Promise<JSONObject>,
  timeoutMs: number,
): Promise<Error | "resolved" | "pending"> {
  return new Promise<Error | "resolved" | "pending">(
    (resolve: (outcome: Error | "resolved" | "pending") => void) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        resolve("pending");
      }, timeoutMs);
      promise.then(
        () => {
          clearTimeout(timer);
          resolve("resolved");
        },
        (error: Error) => {
          clearTimeout(timer);
          resolve(error);
        },
      );
    },
  );
}

const sharedPool: TelemetryDecodeThreadPool = new TelemetryDecodeThreadPool({
  threadCount: 2,
});

const poolsToShutDown: Array<TelemetryDecodeThreadPool> = [sharedPool];

afterAll(async () => {
  /*
   * Terminate every thread this file spawned — leaked workers would
   * keep the jest process alive and trip --detectOpenHandles.
   */
  await Promise.all(
    poolsToShutDown.map((pool: TelemetryDecodeThreadPool) => {
      return pool.shutdown();
    }),
  );
});

describe("DecodeThreadPool — scheduling and id correlation (shared size-2 pool)", () => {
  test("6 concurrent decodes: never more than 2 in flight, and every response matches ITS request", async () => {
    const markers: Array<string> = ["a", "b", "c", "d", "e", "f"];
    const payloads: Array<JSONObject> = markers.map((marker: string) => {
      return makeLogsPayload(marker);
    });
    const buffers: Array<Buffer> = payloads.map((payload: JSONObject) => {
      return encodeLogs(payload);
    });

    const promises: Array<Promise<JSONObject>> = buffers.map(
      (buffer: Buffer) => {
        return sharedPool.decode({
          productType: ProductType.Logs,
          format: OtelPayloadFormat.Protobuf,
          encoding: "none",
          body: buffer,
        });
      },
    );

    /*
     * decode() dispatches synchronously (enqueue + pump before the
     * promise is returned), so right here exactly 2 requests must be on
     * threads and 4 must be queued — this pins one-in-flight-per-thread
     * and FIFO admission at the same time.
     */
    const statsAfterDispatch: {
      threadsAlive: number;
      inFlight: number;
      queued: number;
      healthy: boolean;
    } = sharedPool.getStats();
    expect(statsAfterDispatch.threadsAlive).toBe(2);
    expect(statsAfterDispatch.inFlight).toBe(2);
    expect(statsAfterDispatch.queued).toBe(4);

    // Sample stats throughout the drain: in-flight must never exceed 2.
    const inFlightSamples: Array<number> = [];
    const samplePoller: ReturnType<typeof setInterval> = setInterval(() => {
      inFlightSamples.push(sharedPool.getStats().inFlight);
    }, 2);

    let results: Array<JSONObject>;
    try {
      results = await Promise.all(promises);
    } finally {
      clearInterval(samplePoller);
    }

    for (const sample of inFlightSamples) {
      expect(sample).toBeLessThanOrEqual(2);
    }

    /*
     * Each response deep-equals the payload of the request it answers —
     * under interleaving across 2 threads this fails if ids ever
     * cross-correlate.
     */
    for (let i: number = 0; i < markers.length; i++) {
      expect(results[i]).toEqual(payloads[i]);
    }

    const statsAfterDrain: { inFlight: number; queued: number } =
      sharedPool.getStats();
    expect(statsAfterDrain.inFlight).toBe(0);
    expect(statsAfterDrain.queued).toBe(0);
  }, 60000);

  test("a malformed payload rejects ONLY that request; the pool stays healthy and keeps decoding", async () => {
    await expect(
      sharedPool.decode({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "gzip",
        body: Buffer.from("this is not gzip", "utf-8"),
      }),
    ).rejects.toThrow(/incorrect header check|unknown compression method/);

    expect(sharedPool.getStats().healthy).toBe(true);
    expect(sharedPool.getStats().threadsAlive).toBe(2);

    const payload: JSONObject = makeLogsPayload("after-error");
    const decoded: JSONObject = await sharedPool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: encodeLogs(payload),
    });
    expect(decoded).toEqual(payload);
  }, 60000);

  test("the caller's Buffer is copied, not transferred: it stays intact and usable after dispatch", async () => {
    const payload: JSONObject = makeLogsPayload("buffer-safety");
    const body: Buffer = encodeLogs(payload);
    const pristineCopy: Buffer = Buffer.from(
      new Uint8Array(body as unknown as Uint8Array),
    );

    const poolResult: JSONObject = await sharedPool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: body,
    });
    expect(poolResult).toEqual(payload);

    /*
     * Byte-identical to the pre-dispatch copy: a transfer of the
     * caller's own ArrayBuffer would have detached it (length 0) or —
     * for a Buffer-pool-slab view — corrupted unrelated memory.
     */
    expect(body.length).toBe(pristineCopy.length);
    expect(body.equals(pristineCopy as unknown as Uint8Array)).toBe(true);

    // Still usable: the SAME Buffer decodes inline to the same result.
    const inlineResult: JSONObject = await OtelDecode.decodeBody({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: body,
    });
    expect(inlineResult).toEqual(poolResult);
  }, 60000);

  test("a nonzero-byteOffset Buffer view (ioredis-style slab view) decodes identically to inline, and the slab stays untouched", async () => {
    const payload: JSONObject = makeLogsPayload("slab-view");
    const encoded: Buffer = encodeLogs(payload);

    /*
     * Production bodies come from ioredis, whose reply Buffers are
     * routinely nonzero-offset VIEWS over a shared read slab. Model
     * that exactly: a large sentinel-filled backing Buffer with the
     * real payload written at offset 1024, and the decode input a
     * subarray view over just the payload bytes.
     */
    const backing: Buffer = Buffer.alloc(64 * 1024, 0xee);
    backing.set(encoded as unknown as Uint8Array, 1024);
    const view: Buffer = backing.subarray(1024, 1024 + encoded.length);

    /*
     * Fixture preconditions: if a future refactor hands the pool a
     * zero-offset or non-shared Buffer here, this test would silently
     * stop covering the whole-slab copy/transfer bug — fail loudly
     * instead.
     */
    expect(view.byteOffset).not.toBe(0);
    expect(view.buffer.byteLength).toBeGreaterThan(view.length);

    const slabSnapshot: Buffer = Buffer.from(
      new Uint8Array(backing as unknown as Uint8Array),
    );

    /*
     * The pool's copy-then-transfer site must copy exactly the VIEW's
     * bytes. The classic bug is copying (or transferring) the entire
     * underlying ArrayBuffer, which would hand the worker 1024 bytes of
     * sentinel garbage ahead of the payload — or detach/corrupt slab
     * memory the caller still owns.
     */
    const poolResult: JSONObject = await sharedPool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: view,
    });

    const inlineResult: JSONObject = await OtelDecode.decodeBody({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: view,
    });

    expect(poolResult).toEqual(inlineResult);
    expect(poolResult).toEqual(payload);

    /*
     * Byte-identical slab: pins the bytes OUTSIDE the view (a whole-
     * slab transfer would have detached them, a stray write would have
     * clobbered the sentinel) as well as the view bytes themselves.
     */
    expect(backing.length).toBe(slabSnapshot.length);
    expect(backing.equals(slabSnapshot as unknown as Uint8Array)).toBe(true);
  }, 60000);
});

describe("DecodeThreadPool — thread death and recovery (dedicated size-1 pool)", () => {
  const lifecyclePool: TelemetryDecodeThreadPool =
    new TelemetryDecodeThreadPool({
      threadCount: 1,
    });

  beforeAll(() => {
    poolsToShutDown.push(lifecyclePool);
  });

  test("terminating a busy thread rejects ONLY its in-flight request, then the pool respawns and recovers", async () => {
    const largeBody: Buffer = encodeLogs(makeLargeLogsPayload(5000));

    const doomedDecode: Promise<JSONObject> = lifecyclePool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: largeBody,
    });

    /*
     * Kill the (only) thread while the request is in flight. On a
     * fresh pool the worker is still compiling under ts-node at this
     * point, so the request is deterministically unanswered.
     */
    const workers: Array<Worker> = lifecyclePool.getWorkerThreadsForTesting();
    expect(workers.length).toBe(1);
    await (workers[0] as Worker).terminate();

    await expect(doomedDecode).rejects.toThrow(
      /TelemetryDecodeThreadPool.*thread death/,
    );

    /*
     * One isolated death must NOT trip the breaker: the pool respawned
     * a replacement and the next decode succeeds on it.
     */
    expect(lifecyclePool.getStats().healthy).toBe(true);
    expect(lifecyclePool.getStats().threadsAlive).toBe(1);

    const payload: JSONObject = makeLogsPayload("post-respawn");
    const decoded: JSONObject = await lifecyclePool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: encodeLogs(payload),
    });
    expect(decoded).toEqual(payload);
  }, 60000);

  test("FIFO on a single thread: requests complete in submission order", async () => {
    const completionOrder: Array<number> = [];
    const markers: Array<string> = ["first", "second", "third"];

    const promises: Array<Promise<void>> = markers.map(
      (marker: string, index: number) => {
        return lifecyclePool
          .decode({
            productType: ProductType.Logs,
            format: OtelPayloadFormat.Protobuf,
            encoding: "none",
            body: encodeLogs(makeLogsPayload(marker)),
          })
          .then((decoded: JSONObject) => {
            completionOrder.push(index);
            expect(decoded).toEqual(makeLogsPayload(marker));
          });
      },
    );

    await Promise.all(promises);

    // One thread + FIFO queue => strict submission order.
    expect(completionOrder).toEqual([0, 1, 2]);
  }, 60000);

  test("shutdown terminates the threads and refuses further work", async () => {
    await lifecyclePool.shutdown();

    expect(lifecyclePool.getStats().threadsAlive).toBe(0);
    expect(lifecyclePool.getStats().inFlight).toBe(0);
    expect(lifecyclePool.isAccepting()).toBe(false);

    await expect(
      lifecyclePool.decode({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        body: encodeLogs(makeLogsPayload("too-late")),
      }),
    ).rejects.toThrow(/shutting down/);
  }, 60000);
});

describe("DecodeThreadPool — unhealthy breaker (dedicated size-1 pool, trip threshold 1)", () => {
  const breakerPool: TelemetryDecodeThreadPool = new TelemetryDecodeThreadPool({
    threadCount: 1,
    /*
     * Trip on the FIRST failure so the test doesn't need to stage a
     * crash loop; the cooldown is long enough that the pool stays
     * unhealthy for the rest of the test.
     */
    maxConsecutiveThreadFailures: 1,
    unhealthyCooldownMs: 5 * 60 * 1000,
  });

  beforeAll(() => {
    poolsToShutDown.push(breakerPool);
  });

  test("hitting the failure threshold marks the pool unhealthy and rejects new work until cooldown", async () => {
    const doomedDecode: Promise<JSONObject> = breakerPool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: encodeLogs(makeLargeLogsPayload(5000)),
    });

    const workers: Array<Worker> = breakerPool.getWorkerThreadsForTesting();
    expect(workers.length).toBe(1);
    await (workers[0] as Worker).terminate();

    await expect(doomedDecode).rejects.toThrow(/TelemetryDecodeThreadPool/);

    // Threshold 1 => the single death tripped the breaker.
    expect(breakerPool.getStats().healthy).toBe(false);
    expect(breakerPool.getStats().threadsAlive).toBe(0);
    expect(breakerPool.isAccepting()).toBe(false);

    /*
     * While unhealthy (in cooldown), decode() rejects retryably instead
     * of queueing onto a pool with no threads — the routing layer sees
     * isAccepting() === false and decodes inline instead.
     */
    await expect(
      breakerPool.decode({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        body: encodeLogs(makeLogsPayload("while-unhealthy")),
      }),
    ).rejects.toThrow(/unhealthy/);
  }, 60000);
});

describe("DecodeThreadPool — breaker heals after cooldown (dedicated size-1 pool, 200ms cooldown)", () => {
  const healingPool: TelemetryDecodeThreadPool = new TelemetryDecodeThreadPool({
    threadCount: 1,
    /*
     * Trip on the FIRST failure (as in the breaker suite above), but
     * with a cooldown short enough that this test can wait it out and
     * exercise the recovery path the 5-minute-cooldown suite never
     * reaches.
     */
    maxConsecutiveThreadFailures: 1,
    unhealthyCooldownMs: 200,
  });

  beforeAll(() => {
    poolsToShutDown.push(healingPool);
  });

  test("after the cooldown elapses the pool accepts again, lazily respawns, and decodes successfully", async () => {
    const doomedDecode: Promise<JSONObject> = healingPool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: encodeLogs(makeLargeLogsPayload(5000)),
    });

    const workers: Array<Worker> = healingPool.getWorkerThreadsForTesting();
    expect(workers.length).toBe(1);
    await (workers[0] as Worker).terminate();

    await expect(doomedDecode).rejects.toThrow(/TelemetryDecodeThreadPool/);

    // Threshold 1 => the single death tripped the breaker.
    expect(healingPool.getStats().healthy).toBe(false);
    expect(healingPool.getStats().threadsAlive).toBe(0);
    expect(healingPool.isAccepting()).toBe(false);

    // Wait comfortably past the 200ms cooldown.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 350);
    });

    /*
     * Cooldown elapsed: the pool advertises itself as accepting again,
     * but recovery is LAZY — no thread respawns (and `healthy` stays
     * false) until the next decode() actually arrives.
     */
    expect(healingPool.isAccepting()).toBe(true);
    expect(healingPool.getStats().healthy).toBe(false);
    expect(healingPool.getStats().threadsAlive).toBe(0);

    const payload: JSONObject = makeLogsPayload("post-cooldown");
    const decoded: JSONObject = await healingPool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: encodeLogs(payload),
    });
    expect(decoded).toEqual(payload);

    // The decode reset the breaker and respawned exactly one thread.
    expect(healingPool.getStats().healthy).toBe(true);
    expect(healingPool.getStats().threadsAlive).toBe(1);
  }, 60000);
});

describe("DecodeThreadPool — no hung promises at shutdown (dedicated size-1 pool, zero drain budget)", () => {
  const shutdownPool: TelemetryDecodeThreadPool = new TelemetryDecodeThreadPool(
    {
      threadCount: 1,
      /*
       * Zero drain budget: shutdown() must not wait for the in-flight
       * decode — it rejects it immediately, which is exactly the path
       * under test.
       */
      shutdownDrainTimeoutMs: 0,
    },
  );

  beforeAll(() => {
    poolsToShutDown.push(shutdownPool);
  });

  test("shutdown() with in-flight AND queued work settles every outstanding promise as a retryable rejection", async () => {
    /*
     * Occupy the single thread (on a fresh pool the worker is still
     * compiling under ts-node, so this is deterministically in flight)
     * and queue two more requests behind it.
     */
    const inFlightDecode: Promise<JSONObject> = shutdownPool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: encodeLogs(makeLargeLogsPayload(5000)),
    });
    const queuedDecodes: Array<Promise<JSONObject>> = ["q1", "q2"].map(
      (marker: string) => {
        return shutdownPool.decode({
          productType: ProductType.Logs,
          format: OtelPayloadFormat.Protobuf,
          encoding: "none",
          body: encodeLogs(makeLogsPayload(marker)),
        });
      },
    );

    expect(shutdownPool.getStats().inFlight).toBe(1);
    expect(shutdownPool.getStats().queued).toBe(2);

    // Probes attached BEFORE shutdown so no rejection is ever unobserved.
    const probes: Array<Promise<Error | "resolved" | "pending">> = [
      inFlightDecode,
      ...queuedDecodes,
    ].map((promise: Promise<JSONObject>) => {
      return settlementWithin(promise, 2000);
    });

    await shutdownPool.shutdown();

    const outcomes: Array<Error | "resolved" | "pending"> =
      await Promise.all(probes);

    // ALL THREE must settle as rejections — "pending" is a hung job.
    for (const outcome of outcomes) {
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toMatch(/^TelemetryDecodeThreadPool/);
    }
    expect((outcomes[0] as Error).message).toMatch(
      /still in flight at shutdown/,
    );
    expect((outcomes[1] as Error).message).toMatch(/shut down before dispatch/);
    expect((outcomes[2] as Error).message).toMatch(/shut down before dispatch/);

    expect(shutdownPool.getStats().threadsAlive).toBe(0);
    expect(shutdownPool.getStats().inFlight).toBe(0);
    expect(shutdownPool.getStats().queued).toBe(0);
    expect(shutdownPool.isAccepting()).toBe(false);
  }, 60000);
});

describe("DecodeThreadPool — no hung promises on breaker trip with queued work (dedicated size-1 pool, trip threshold 1)", () => {
  const trippedQueuePool: TelemetryDecodeThreadPool =
    new TelemetryDecodeThreadPool({
      threadCount: 1,
      maxConsecutiveThreadFailures: 1,
      unhealthyCooldownMs: 5 * 60 * 1000,
    });

  beforeAll(() => {
    poolsToShutDown.push(trippedQueuePool);
  });

  test("terminating the busy thread rejects the in-flight request AND both queued requests — none stranded", async () => {
    const inFlightDecode: Promise<JSONObject> = trippedQueuePool.decode({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: encodeLogs(makeLargeLogsPayload(5000)),
    });
    const queuedDecodes: Array<Promise<JSONObject>> = ["q1", "q2"].map(
      (marker: string) => {
        return trippedQueuePool.decode({
          productType: ProductType.Logs,
          format: OtelPayloadFormat.Protobuf,
          encoding: "none",
          body: encodeLogs(makeLogsPayload(marker)),
        });
      },
    );

    expect(trippedQueuePool.getStats().inFlight).toBe(1);
    expect(trippedQueuePool.getStats().queued).toBe(2);

    const probes: Array<Promise<Error | "resolved" | "pending">> = [
      inFlightDecode,
      ...queuedDecodes,
    ].map((promise: Promise<JSONObject>) => {
      return settlementWithin(promise, 5000);
    });

    const workers: Array<Worker> =
      trippedQueuePool.getWorkerThreadsForTesting();
    expect(workers.length).toBe(1);
    await (workers[0] as Worker).terminate();

    const outcomes: Array<Error | "resolved" | "pending"> =
      await Promise.all(probes);

    /*
     * The thread death rejects the in-flight request; tripping the
     * breaker (threshold 1) must then reject the queued requests too,
     * not leave them stranded on a pool with no threads.
     */
    for (const outcome of outcomes) {
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toMatch(/^TelemetryDecodeThreadPool/);
    }
    expect((outcomes[0] as Error).message).toMatch(/thread death/);
    expect((outcomes[1] as Error).message).toMatch(/unhealthy/);
    expect((outcomes[2] as Error).message).toMatch(/unhealthy/);

    expect(trippedQueuePool.getStats().healthy).toBe(false);
    expect(trippedQueuePool.getStats().threadsAlive).toBe(0);
    expect(trippedQueuePool.getStats().inFlight).toBe(0);
    expect(trippedQueuePool.getStats().queued).toBe(0);
    expect(trippedQueuePool.isAccepting()).toBe(false);
  }, 60000);
});
