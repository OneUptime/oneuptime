import path from "path";
// Node's own timers, which unref: a process is never kept alive by the model.
import timers from "timers";
import { Worker } from "worker_threads";

/*
 * THE SCANNER'S SIDE OF THE MODEL'S THREAD (NameAddressModelWorker.cjs).
 *
 * The thread loads the model once and then runs one batch at a time: the
 * scanner sends token ids and waits for the logits, so the model time a batch
 * took is known before the next one starts (ModelBudget). A batch that takes
 * longer than RUN_TIME_LIMIT_IN_MS ends the thread; the scan carries on
 * without the model, and the next scan starts the thread again.
 *
 * The thread is unref'd: it never keeps a process alive on its own.
 */

export const NAME_ADDRESS_MODEL_WORKER_PATH: string = path.join(
  __dirname,
  "NameAddressModelWorker.cjs",
);

// How long the model may take to load, and one batch to run.
export const LOAD_TIME_LIMIT_IN_MS: number = 2 * 60 * 1000;
export const RUN_TIME_LIMIT_IN_MS: number = 60 * 1000;

export interface ModelBatch {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
  rows: number;
  width: number;
}

export interface ModelBatchResult {
  // rows x width x labels, row-major.
  logits: Float32Array;
  labels: number;
  /*
   * How long the model ran on the batch, measured in its thread: what the
   * batch is charged, however long it waited behind another scan's.
   */
  elapsedInMs?: number | undefined;
}

interface PendingRun {
  resolve: (result: ModelBatchResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ModelThreadOptions {
  modelPath: string;
  // Another thread speaking the same messages: tests.
  workerPath?: string | undefined;
  loadTimeLimitInMs?: number | undefined;
  runTimeLimitInMs?: number | undefined;
  // Told of every attempt the thread made to reach the network.
  onNetworkAttempt?: ((api: string) => void) | undefined;
}

export class ModelThreadError extends Error {}

export default class NameAddressModelThread {
  private readonly worker: Worker;
  private readonly runTimeLimitInMs: number;
  private readonly pending: Map<number, PendingRun> = new Map();
  private nextId: number = 1;
  private exited: boolean = false;
  // The last batch sent or waiting: the next one goes after it.
  private tail: Promise<unknown> = Promise.resolve();

  private constructor(worker: Worker, runTimeLimitInMs: number) {
    this.worker = worker;
    this.runTimeLimitInMs = runTimeLimitInMs;
  }

  public get isRunning(): boolean {
    return !this.exited;
  }

  public static async start(
    options: ModelThreadOptions,
  ): Promise<NameAddressModelThread> {
    const worker: Worker = new Worker(
      options.workerPath || NAME_ADDRESS_MODEL_WORKER_PATH,
      {
        workerData: { modelPath: options.modelPath },
        stdout: false,
        stderr: false,
      },
    );
    const thread: NameAddressModelThread = new NameAddressModelThread(
      worker,
      options.runTimeLimitInMs || RUN_TIME_LIMIT_IN_MS,
    );

    worker.unref();

    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {
        let settled: boolean = false;
        const finish: (error?: Error) => void = (error?: Error): void => {
          if (settled) {
            return;
          }

          settled = true;
          timers.clearTimeout(timer);

          if (error) {
            void thread.close();
            reject(error);
          } else {
            resolve();
          }
        };
        const timer: NodeJS.Timeout = timers.setTimeout((): void => {
          finish(new ModelThreadError("The model took too long to load."));
        }, options.loadTimeLimitInMs || LOAD_TIME_LIMIT_IN_MS);

        timer.unref();

        worker.on("message", (message: Record<string, unknown>): void => {
          if (message["type"] === "network-attempt") {
            options.onNetworkAttempt?.(String(message["api"] || ""));
            return;
          }

          if (message["type"] === "ready") {
            finish();
            return;
          }

          if (message["type"] === "failed") {
            finish(
              new ModelThreadError(
                `The model could not load: ${String(message["message"] || "")}`,
              ),
            );
            return;
          }

          thread.onRunMessage(message);
        });
        worker.on("error", (error: Error): void => {
          thread.markExited(error);
          finish(
            new ModelThreadError(`The model's thread failed: ${error.name}`),
          );
        });
        worker.on("exit", (): void => {
          thread.markExited(new ModelThreadError("The model's thread ended."));
          finish(new ModelThreadError("The model's thread ended."));
        });
      },
    );

    return thread;
  }

  private markExited(error: Error): void {
    this.exited = true;

    for (const [id, run] of this.pending) {
      timers.clearTimeout(run.timer);
      run.reject(error);
      this.pending.delete(id);
    }
  }

  private onRunMessage(message: Record<string, unknown>): void {
    const id: number = Number(message["id"]);
    const run: PendingRun | undefined = this.pending.get(id);

    if (!run) {
      return;
    }

    this.pending.delete(id);
    timers.clearTimeout(run.timer);

    /*
     * A typed array of whichever realm the message landed in: instanceof
     * would refuse one from another (as under a test's jsdom).
     */
    const logits: unknown = message["logits"];

    if (message["type"] === "logits" && ArrayBuffer.isView(logits)) {
      const elapsed: number = Number(message["elapsedInMs"]);

      run.resolve({
        logits: logits as Float32Array,
        labels: Number(message["labels"]),
        elapsedInMs: Number.isFinite(elapsed) ? elapsed : undefined,
      });
      return;
    }

    run.reject(
      new ModelThreadError(
        `The model could not read a batch: ${String(message["message"] || "")}`,
      ),
    );
  }

  /*
   * Runs one batch. Batches of several scans of the process go one after
   * another: each is sent once the one before it is answered, so its time
   * limit counts its own run, never a wait.
   */
  public async run(batch: ModelBatch): Promise<ModelBatchResult> {
    const turn: Promise<ModelBatchResult> = this.tail.then(
      (): Promise<ModelBatchResult> => {
        return this.send(batch);
      },
    );

    this.tail = turn.catch((): void => {
      // The next batch goes on whatever this one did.
    });

    return await turn;
  }

  private async send(batch: ModelBatch): Promise<ModelBatchResult> {
    if (this.exited) {
      throw new ModelThreadError("The model's thread is not running.");
    }

    const id: number = this.nextId++;

    return await new Promise<ModelBatchResult>(
      (
        resolve: (result: ModelBatchResult) => void,
        reject: (error: Error) => void,
      ): void => {
        const timer: NodeJS.Timeout = timers.setTimeout((): void => {
          this.pending.delete(id);
          reject(new ModelThreadError("The model took too long on a batch."));
          void this.close();
        }, this.runTimeLimitInMs);

        timer.unref();
        this.pending.set(id, { resolve, reject, timer });
        this.worker.postMessage(
          {
            type: "run",
            id,
            inputIds: batch.inputIds,
            attentionMask: batch.attentionMask,
            tokenTypeIds: batch.tokenTypeIds,
            rows: batch.rows,
            width: batch.width,
          },
          [
            batch.inputIds.buffer as ArrayBuffer,
            batch.attentionMask.buffer as ArrayBuffer,
            batch.tokenTypeIds.buffer as ArrayBuffer,
          ],
        );
      },
    );
  }

  public async close(): Promise<void> {
    if (this.exited) {
      return;
    }

    this.markExited(new ModelThreadError("The model's thread was closed."));

    try {
      await this.worker.terminate();
    } catch {
      // Already gone.
    }
  }
}
