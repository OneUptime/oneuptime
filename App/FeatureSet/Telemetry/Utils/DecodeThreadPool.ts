import { Worker } from "worker_threads";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import logger from "Common/Server/Utils/Logger";
import GracefulShutdown, {
  ShutdownPriority,
} from "Common/Server/Utils/GracefulShutdown";
import { OtelPayloadEncoding, OtelPayloadFormat } from "./OtelDecode";
import {
  DecodeRequestMessage,
  DecodeResponseMessage,
} from "./DecodeWorkerThread";
import { TELEMETRY_DECODE_THREADS } from "../Config";

/*
 * Worker-thread pool for OTel payload decoding.
 *
 * gunzip inflate + protobuf decode + `.toJSON()` of a large telemetry
 * batch is tens-to-hundreds of milliseconds of UNBROKEN synchronous CPU
 * on the BullMQ worker's event loop. With TELEMETRY_CONCURRENCY jobs in
 * flight that sync burn serializes everything else on the loop (queue
 * heartbeats, Redis pings, fan-in flush timers). This pool moves that
 * CPU onto worker_threads so the main loop only pays a memcpy + message
 * hop per payload.
 *
 * ENABLED BY DEFAULT, ADAPTIVELY SIZED: TELEMETRY_DECODE_THREADS
 * defaults to clamp(effectiveCpuCount - 1, 0, 4), cgroup-aware — see
 * Config.ts for the full sizing table and rationale. On a 1-effective-
 * CPU pod (or with an explicit TELEMETRY_DECODE_THREADS=0, the hard-off
 * switch) that resolves to 0: the pool never starts a thread and
 * decodeFromQueue takes the inline path — byte-for-byte the pre-pool
 * behavior.
 *
 * Runtime/loading model: the app runs through ts-node in BOTH dev and
 * prod (nodemon dev exec and the prod `npm start` both `-r ts-node/
 * register`), so the worker entry is the DecodeWorkerThread.ts SOURCE
 * file, loaded with an explicit `-r ts-node/register/transpile-only`
 * in execArgv. Explicit rather than inherited, because the spawning
 * process is not always ts-node-registered (jest/ts-jest is not) — the
 * explicit execArgv is what lets tests spawn REAL threads. Note that
 * `--no-node-snapshot` (which the main process runs with) is NOT passed:
 * Node rejects it in worker execArgv ("invalid execArgv flags") because
 * it is a process-level flag; workers share the main process's snapshot
 * state anyway.
 *
 * Concurrency/backpressure model: one in-flight request per thread and
 * a FIFO pending queue with NO cap of its own — outstanding decode
 * requests are already bounded by TELEMETRY_CONCURRENCY (the BullMQ
 * worker concurrency, 100 by default), because each request belongs to
 * exactly one in-flight job.
 */

export interface DecodeInput {
  productType: ProductType;
  format: OtelPayloadFormat;
  encoding: OtelPayloadEncoding;
  body: Buffer;
}

export interface DecodeThreadPoolStats {
  threadsAlive: number;
  inFlight: number;
  queued: number;
  healthy: boolean;
}

export interface DecodeThreadPoolOptions {
  threadCount: number;
  /*
   * Failure-guard knobs. Overridable primarily for tests; production
   * uses the defaults below.
   */
  maxConsecutiveThreadFailures?: number;
  threadFailureWindowMs?: number;
  unhealthyCooldownMs?: number;
  shutdownDrainTimeoutMs?: number;
}

interface PendingRequest {
  id: number;
  message: DecodeRequestMessage;
  transferList: Array<ArrayBuffer>;
  resolve: (result: JSONObject) => void;
  reject: (error: Error) => void;
}

interface PoolThread {
  worker: Worker;
  inFlightRequest: PendingRequest | null;
}

/*
 * Every rejection this pool emits is RETRYABLE BY DESIGN: the caller is
 * a BullMQ job handler, and any error thrown from a job triggers the
 * queue's normal retry/backoff — on the retry the routing layer
 * re-evaluates pool health and falls back to the inline decoder if the
 * pool has been marked unhealthy in the meantime. The stable prefix
 * makes these rejections greppable in job-failure logs.
 */
const RETRYABLE_MESSAGE_PREFIX: string = "TelemetryDecodeThreadPool";

function buildRetryableError(detail: string): Error {
  return new Error(
    `${RETRYABLE_MESSAGE_PREFIX}: ${detail} (the job queue will retry this job; the retry decodes inline if the pool is unavailable)`,
  );
}

export class TelemetryDecodeThreadPool {
  private options: Required<DecodeThreadPoolOptions>;
  private threads: Array<PoolThread> = [];
  private pendingQueue: Array<PendingRequest> = [];
  /*
   * Monotonic id counter for request/response correlation. A plain
   * counter (not Date.now()) because two requests dispatched in the
   * same millisecond must never share an id.
   */
  private nextRequestId: number = 1;
  private shuttingDown: boolean = false;
  private healthy: boolean = true;
  private consecutiveThreadFailures: number = 0;
  private lastThreadFailureAtMs: number = 0;
  private unhealthyUntilMs: number = 0;

  public constructor(options: DecodeThreadPoolOptions) {
    if (options.threadCount <= 0) {
      throw new Error(
        "TelemetryDecodeThreadPool: threadCount must be > 0 (a disabled pool is simply never constructed)",
      );
    }

    this.options = {
      threadCount: options.threadCount,
      /*
       * Respawn-storm guard defaults: 5 thread failures within a
       * rolling 30s window (e.g. the worker entry file failing to
       * compile, or threads OOMing instantly) marks the pool unhealthy
       * for 60s. While unhealthy, isAccepting() is false, so the
       * routing layer decodes inline — degraded latency, but ingest
       * keeps flowing instead of burning CPU on spawn/crash cycles.
       */
      maxConsecutiveThreadFailures: options.maxConsecutiveThreadFailures ?? 5,
      threadFailureWindowMs: options.threadFailureWindowMs ?? 30_000,
      unhealthyCooldownMs: options.unhealthyCooldownMs ?? 60_000,
      /*
       * Shutdown drain budget. Must stay comfortably under
       * GracefulShutdown's 10s per-handler timeout.
       */
      shutdownDrainTimeoutMs: options.shutdownDrainTimeoutMs ?? 5_000,
    };
  }

  /*
   * Whether this pool should be handed new work. False while shutting
   * down and while in the unhealthy cooldown; flips back to true (with
   * counters reset and threads respawned lazily) once the cooldown
   * elapses and the next decode() arrives.
   */
  public isAccepting(): boolean {
    if (this.shuttingDown) {
      return false;
    }
    if (this.healthy) {
      return true;
    }
    return Date.now() >= this.unhealthyUntilMs;
  }

  public decode(input: DecodeInput): Promise<JSONObject> {
    if (this.shuttingDown) {
      return Promise.reject(buildRetryableError("pool is shutting down"));
    }

    if (!this.healthy) {
      if (Date.now() < this.unhealthyUntilMs) {
        /*
         * Callers are expected to check isAccepting() before calling,
         * but the state can flip between check and call — reject
         * (retryably) rather than queue onto a pool with no threads.
         */
        return Promise.reject(
          buildRetryableError("pool is unhealthy (in cooldown)"),
        );
      }
      // Cooldown elapsed — recover: reset counters, respawn below.
      this.healthy = true;
      this.consecutiveThreadFailures = 0;
    }

    this.ensureThreadsSpawned();

    if (this.threads.length === 0) {
      // ensureThreadsSpawned failed synchronously and marked us unhealthy.
      return Promise.reject(
        buildRetryableError("no decode threads could be spawned"),
      );
    }

    /*
     * Copy the payload into a FRESH ArrayBuffer and transfer that.
     *
     * WHY THE COPY: transferring detaches the ENTIRE underlying
     * ArrayBuffer, and the caller's Buffer is not guaranteed to own its
     * ArrayBuffer — ioredis result Buffers (and any Buffer.allocUnsafe
     * product) can be views on Node's shared Buffer pool slab, so
     * transferring `input.body.buffer` would detach unrelated data that
     * happens to live on the same slab (and corrupt the caller's Buffer
     * besides). One explicit memcpy on the main thread is the price of
     * a zero-copy handoff into the worker; the decode itself (the
     * expensive part) then runs entirely off-loop.
     */
    const transferable: ArrayBuffer = new ArrayBuffer(input.body.length);
    new Uint8Array(transferable).set(input.body as unknown as Uint8Array);

    const requestId: number = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<JSONObject>(
      (
        resolve: (result: JSONObject) => void,
        reject: (error: Error) => void,
      ) => {
        const request: PendingRequest = {
          id: requestId,
          message: {
            id: requestId,
            productType: input.productType,
            format: input.format,
            encoding: input.encoding,
            payload: transferable,
          },
          transferList: [transferable],
          resolve: resolve,
          reject: reject,
        };

        // FIFO admission: enqueue at the tail, pump dispatches from the head.
        this.pendingQueue.push(request);
        this.pump();
      },
    );
  }

  public getStats(): DecodeThreadPoolStats {
    return {
      threadsAlive: this.threads.length,
      inFlight: this.threads.filter((thread: PoolThread) => {
        return thread.inFlightRequest !== null;
      }).length,
      queued: this.pendingQueue.length,
      healthy: this.healthy,
    };
  }

  /*
   * Test hook: expose the live Worker handles so lifecycle tests can
   * kill a busy thread with worker.terminate() and assert the pool's
   * reject-and-respawn behavior. Not for production use.
   */
  public getWorkerThreadsForTesting(): Array<Worker> {
    return this.threads.map((thread: PoolThread) => {
      return thread.worker;
    });
  }

  /*
   * Graceful shutdown: stop accepting, give in-flight decodes a short
   * drain window (they feed jobs that the Workers tier is still
   * draining — see the priority-tier discussion in DecodeThreadPool's
   * facade below), then terminate every thread. Idempotent.
   */
  public async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    /*
     * Queued-but-not-dispatched requests will never run — reject them
     * now (retryably) instead of leaving their jobs to hang into the
     * BullMQ lock timeout.
     */
    const queuedRequests: Array<PendingRequest> = this.pendingQueue;
    this.pendingQueue = [];
    for (const request of queuedRequests) {
      request.reject(buildRetryableError("pool shut down before dispatch"));
    }

    // Brief drain: let dispatched decodes finish feeding their jobs.
    const drainDeadlineMs: number =
      Date.now() + this.options.shutdownDrainTimeoutMs;
    while (this.getStats().inFlight > 0 && Date.now() < drainDeadlineMs) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 25);
      });
    }

    /*
     * Detach the thread records BEFORE terminating so the 'exit'
     * handlers see an already-emptied pool and do not count these
     * deliberate terminations as failures (or attempt respawns).
     */
    const threadsToTerminate: Array<PoolThread> = this.threads;
    this.threads = [];

    for (const thread of threadsToTerminate) {
      if (thread.inFlightRequest) {
        thread.inFlightRequest.reject(
          buildRetryableError("decode was still in flight at shutdown"),
        );
        thread.inFlightRequest = null;
      }
    }

    await Promise.all(
      threadsToTerminate.map((thread: PoolThread) => {
        return thread.worker.terminate().catch((err: Error) => {
          logger.warn("TelemetryDecodeThreadPool: terminate() failed:");
          logger.warn(err);
        });
      }),
    );
  }

  /*
   * Spawn up to threadCount threads. Idempotent — called on every
   * decode() so a pool recovering from cooldown (or one that lost a
   * thread to a synchronous spawn failure) heals lazily.
   */
  private ensureThreadsSpawned(): void {
    while (
      this.threads.length < this.options.threadCount &&
      this.healthy &&
      !this.shuttingDown
    ) {
      this.spawnThread();
    }
  }

  private spawnThread(): void {
    /*
     * The worker entry lives next to this file. Under ts-node and
     * ts-jest, __filename is the .ts source path, so the entry is the
     * .ts file and needs the ts-node register hook; if this code is
     * ever run precompiled (__filename ends in .js), spawn the compiled
     * neighbor with no extra execArgv instead.
     */
    const entryExtension: string = path.extname(__filename);
    const workerEntryPath: string = path.join(
      __dirname,
      `DecodeWorkerThread${entryExtension}`,
    );

    /*
     * require.resolve rather than the bare "ts-node/register/..."
     * specifier: node resolves `--require` relative to the process
     * CWD, which is the App directory in every normal run but is not
     * something a library should depend on. Resolving from THIS file's
     * location pins it to App/node_modules/ts-node regardless of CWD.
     */
    const execArgv: Array<string> =
      entryExtension === ".ts"
        ? ["-r", require.resolve("ts-node/register/transpile-only")]
        : [];

    /*
     * TS_NODE_PROJECT pins the worker's ts-node to App's tsconfig for
     * the same CWD-independence reason (ts-node searches from CWD by
     * default). __dirname is App/FeatureSet/Telemetry/Utils, so App's
     * root is three levels up.
     */
    const appTsconfigPath: string = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "tsconfig.json",
    );

    try {
      const worker: Worker = new Worker(workerEntryPath, {
        execArgv: execArgv,
        env: {
          ...process.env,
          TS_NODE_PROJECT: appTsconfigPath,
        },
      });

      const thread: PoolThread = {
        worker: worker,
        inFlightRequest: null,
      };

      worker.on("message", (response: DecodeResponseMessage) => {
        this.onThreadMessage(thread, response);
      });
      worker.on("error", (error: Error) => {
        this.onThreadFailure(thread, `thread error: ${error.message}`);
      });
      worker.on("exit", (code: number) => {
        this.onThreadFailure(thread, `thread exited with code ${code}`);
      });

      this.threads.push(thread);
    } catch (err) {
      /*
       * A synchronous Worker-constructor failure (bad execArgv, missing
       * entry file) will fail identically on every attempt — do NOT
       * retry in a loop here. Route it through the same failure counter
       * as async thread deaths; repeated failures trip the unhealthy
       * breaker below and callers fall back inline.
       */
      logger.error("TelemetryDecodeThreadPool: failed to spawn thread:");
      logger.error(err);
      this.recordThreadFailure();
      if (this.healthy) {
        /*
         * Not tripped yet, but spawning is clearly broken right now —
         * mark unhealthy immediately rather than letting every decode()
         * call re-attempt a doomed synchronous spawn loop.
         */
        this.markUnhealthy("worker thread spawn failed synchronously");
      }
    }
  }

  private onThreadMessage(
    thread: PoolThread,
    response: DecodeResponseMessage,
  ): void {
    const request: PendingRequest | null = thread.inFlightRequest;

    if (!request || request.id !== response.id) {
      /*
       * Protocol violation — a response we have no matching request
       * for. Should be impossible with one in-flight per thread and
       * monotonic ids; log loudly, and if something WAS in flight on
       * this thread, fail it (retryably) rather than leaving its job
       * to hang until the BullMQ lock timeout.
       */
      logger.error(
        `TelemetryDecodeThreadPool: response id ${response.id} does not match in-flight request ${request ? request.id : "<none>"}. Dropping response.`,
      );
      if (request) {
        thread.inFlightRequest = null;
        request.reject(
          buildRetryableError("request/response id correlation lost"),
        );
        this.pump();
      }
      return;
    }

    thread.inFlightRequest = null;

    /*
     * Any well-formed response — success OR a per-message decode error
     * — proves the thread itself is alive and orderly, so it resets the
     * consecutive-failure breaker.
     */
    this.consecutiveThreadFailures = 0;

    if (response.ok) {
      request.resolve(response.result);
    } else {
      /*
       * Per-message failure (malformed gzip/protobuf/JSON): reject ONLY
       * this request with the worker's error; the thread stays in the
       * pool. Mirrors what the inline decoder would have thrown.
       */
      const error: Error = new Error(response.errorMessage);
      if (response.errorStack) {
        error.stack = response.errorStack;
      }
      request.reject(error);
    }

    this.pump();
  }

  /*
   * A thread died ('error' or unexpected 'exit'). Rejects ONLY that
   * thread's in-flight request (retryably — the job layer retries),
   * respawns a replacement, and trips the unhealthy breaker if deaths
   * keep coming.
   *
   * 'error' and 'exit' both fire for one crash; the first call removes
   * the thread record from `this.threads`, so the second (and any exit
   * from a deliberate terminate() in shutdown/markUnhealthy) finds the
   * record already gone and returns without double-handling.
   */
  private onThreadFailure(thread: PoolThread, detail: string): void {
    const threadIndex: number = this.threads.indexOf(thread);
    if (threadIndex < 0) {
      return; // Already handled, or a deliberate termination.
    }
    this.threads.splice(threadIndex, 1);

    const request: PendingRequest | null = thread.inFlightRequest;
    thread.inFlightRequest = null;
    if (request) {
      request.reject(
        buildRetryableError(`decode aborted by thread death (${detail})`),
      );
    }

    logger.warn(`TelemetryDecodeThreadPool: ${detail}.`);

    this.recordThreadFailure();
    if (
      this.consecutiveThreadFailures >=
      this.options.maxConsecutiveThreadFailures
    ) {
      this.markUnhealthy(
        `${this.consecutiveThreadFailures} thread failures within ${this.options.threadFailureWindowMs}ms`,
      );
      return;
    }

    if (!this.shuttingDown) {
      // Respawn a replacement and keep draining the queue.
      this.ensureThreadsSpawned();
      this.pump();
    }
  }

  /*
   * Rolling-window consecutive-failure counter: failures further apart
   * than the window are treated as isolated (counter restarts), so an
   * occasional crash every few minutes never trips the breaker — only
   * a rapid crash loop does.
   */
  private recordThreadFailure(): void {
    const nowMs: number = Date.now();
    if (
      nowMs - this.lastThreadFailureAtMs >
      this.options.threadFailureWindowMs
    ) {
      this.consecutiveThreadFailures = 0;
    }
    this.lastThreadFailureAtMs = nowMs;
    this.consecutiveThreadFailures += 1;
  }

  /*
   * Trip the breaker: reject everything (retryably), tear down any
   * surviving threads, and refuse work until the cooldown elapses.
   * Logged ONCE per transition — this runs during crash loops, and a
   * log line per crashed spawn would itself be a storm.
   */
  private markUnhealthy(reason: string): void {
    if (!this.healthy) {
      return;
    }
    this.healthy = false;
    this.unhealthyUntilMs = Date.now() + this.options.unhealthyCooldownMs;

    logger.error(
      `TelemetryDecodeThreadPool: marking pool UNHEALTHY (${reason}). Falling back to inline decoding for ${this.options.unhealthyCooldownMs}ms.`,
    );

    const queuedRequests: Array<PendingRequest> = this.pendingQueue;
    this.pendingQueue = [];
    for (const request of queuedRequests) {
      request.reject(buildRetryableError(`pool marked unhealthy (${reason})`));
    }

    const threadsToTerminate: Array<PoolThread> = this.threads;
    this.threads = []; // Exit handlers of terminated threads become no-ops.
    for (const thread of threadsToTerminate) {
      if (thread.inFlightRequest) {
        thread.inFlightRequest.reject(
          buildRetryableError(`pool marked unhealthy (${reason})`),
        );
        thread.inFlightRequest = null;
      }
      thread.worker.terminate().catch((err: Error) => {
        logger.warn("TelemetryDecodeThreadPool: terminate() failed:");
        logger.warn(err);
      });
    }
  }

  /*
   * Dispatch loop: hand the head of the FIFO queue to each idle thread.
   * Runs after every enqueue, completion, and respawn; one in-flight
   * request per thread, always.
   */
  private pump(): void {
    if (this.shuttingDown) {
      return;
    }

    for (const thread of this.threads) {
      if (this.pendingQueue.length === 0) {
        return;
      }
      if (thread.inFlightRequest !== null) {
        continue;
      }

      const request: PendingRequest =
        this.pendingQueue.shift() as PendingRequest;
      thread.inFlightRequest = request;

      try {
        thread.worker.postMessage(request.message, request.transferList);
      } catch (err) {
        /*
         * postMessage can throw synchronously (e.g. the ArrayBuffer was
         * somehow already detached). That is a per-request failure, not
         * a thread failure.
         */
        thread.inFlightRequest = null;
        const error: Error =
          err instanceof Error ? err : new Error(String(err));
        request.reject(
          buildRetryableError(`failed to dispatch to thread: ${error.message}`),
        );
      }
    }
  }
}

/*
 * Process-wide facade: the lazy singleton that production code
 * (OtelPayloadDecoder.decodeFromQueue) talks to. Sized by
 * TELEMETRY_DECODE_THREADS (adaptive by default — see Config.ts); when
 * that resolves to 0 (a 1-effective-CPU pod, or an explicit 0) the
 * singleton is never constructed and no thread ever starts. Tests
 * construct TelemetryDecodeThreadPool instances directly instead, so
 * they control pool size without touching env/Config.
 */
export default class DecodeThreadPool {
  private static instance: TelemetryDecodeThreadPool | null = null;

  public static isEnabled(): boolean {
    return TELEMETRY_DECODE_THREADS > 0;
  }

  /*
   * The routing gate for decodeFromQueue: enabled AND (not yet started,
   * which means the first decode will lazily start it) or started-and-
   * accepting (healthy / out of cooldown, not shutting down).
   */
  public static isAvailable(): boolean {
    if (!this.isEnabled()) {
      return false;
    }
    if (!this.instance) {
      return true;
    }
    return this.instance.isAccepting();
  }

  public static decode(input: DecodeInput): Promise<JSONObject> {
    if (!this.isEnabled()) {
      return Promise.reject(
        buildRetryableError(
          "pool is disabled (TELEMETRY_DECODE_THREADS resolved to 0); caller should have routed inline",
        ),
      );
    }

    if (!this.instance) {
      this.instance = new TelemetryDecodeThreadPool({
        threadCount: TELEMETRY_DECODE_THREADS,
      });

      /*
       * Shutdown tier choice — Buffers (30), NOT Workers (20):
       * GracefulShutdown runs tiers in ascending order, and the Workers
       * tier (20) is where the BullMQ workers stop pulling NEW jobs and
       * finish their in-flight ones — in-flight jobs may be awaiting a
       * decode from this pool, so the pool must still be serving while
       * tier 20 drains. Buffers (30) runs after that drain completes,
       * alongside the write-buffer flushes (e.g. TelemetryFanInWriter),
       * which consume decode OUTPUT but never call the pool — so by
       * this tier the pool should be idle, and shutdown() only has to
       * cover the stragglers (brief drain, then terminate). Registered
       * here (first construction) rather than at module load so that
       * merely importing this module never installs signal handlers.
       */
      GracefulShutdown.registerHandler(
        "TelemetryDecodeThreadPool",
        ShutdownPriority.Buffers,
        async () => {
          if (this.instance) {
            await this.instance.shutdown();
          }
        },
      );

      logger.info(
        `TelemetryDecodeThreadPool: enabled with ${TELEMETRY_DECODE_THREADS} thread(s).`,
      );
    }

    return this.instance.decode(input);
  }

  public static getStats(): DecodeThreadPoolStats {
    if (!this.instance) {
      return {
        threadsAlive: 0,
        inFlight: 0,
        queued: 0,
        healthy: this.isEnabled(),
      };
    }
    return this.instance.getStats();
  }
}
