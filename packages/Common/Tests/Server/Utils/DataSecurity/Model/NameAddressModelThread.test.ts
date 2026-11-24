import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import http from "http";
import net from "net";
import path from "path";
import { Worker } from "worker_threads";
import NameAddressModelThread, {
  ModelBatch,
  ModelBatchResult,
  NAME_ADDRESS_MODEL_WORKER_PATH,
} from "../../../../../Server/Utils/DataSecurity/Model/NameAddressModelThread";

/*
 * The scanner's side of the model's thread, against a thread that speaks the
 * same messages (Fixtures/FakeModelThread.cjs), and the thread's network
 * lockdown, in a thread of its own that tries every way out
 * (Fixtures/TriesTheNetwork.cjs).
 */

const FAKE_THREAD: string = path.join(
  __dirname,
  "Fixtures",
  "FakeModelThread.cjs",
);
const LOCKDOWN: string = path.join(
  path.dirname(NAME_ADDRESS_MODEL_WORKER_PATH),
  "NameAddressModelNetworkLockdown.cjs",
);

function batch(ids: Array<number>): ModelBatch {
  return {
    inputIds: BigInt64Array.from(ids.map(BigInt)),
    attentionMask: BigInt64Array.from(
      ids.map((): bigint => {
        return BigInt(1);
      }),
    ),
    tokenTypeIds: new BigInt64Array(ids.length),
    rows: 1,
    width: ids.length,
  };
}

const started: Array<NameAddressModelThread> = [];

async function start(
  mode: string,
  extra: Partial<Parameters<typeof NameAddressModelThread.start>[0]> = {},
): Promise<NameAddressModelThread> {
  // The scanner hands the thread the model's path: the fake reads its mode there.
  const thread: NameAddressModelThread = await NameAddressModelThread.start({
    modelPath: mode,
    workerPath: FAKE_THREAD,
    ...extra,
  });

  started.push(thread);
  return thread;
}

afterEach(async () => {
  for (const thread of started.splice(0)) {
    await thread.close();
  }
});

describe("NameAddressModelThread", () => {
  test("the worker it starts by default is the one the images ship, beside it", () => {
    expect(path.basename(NAME_ADDRESS_MODEL_WORKER_PATH)).toBe(
      "NameAddressModelWorker.cjs",
    );
    expect(fs.existsSync(NAME_ADDRESS_MODEL_WORKER_PATH)).toBe(true);
  });

  test("runs a batch and gives back its logits, labels and the time its thread measured", async () => {
    const thread: NameAddressModelThread = await start("ok");
    const result: ModelBatchResult = await thread.run(batch([2, 5, 7, 3]));

    expect(result.labels).toBe(9);
    expect(result.elapsedInMs).toBe(7);
    expect(result.logits).toHaveLength(4 * 9);
    // Token id 5 is labelled B-PER (3) by the fake, the others O.
    expect(result.logits[1 * 9 + 3]).toBe(10);
    expect(result.logits[0]).toBe(10);
  });

  test("batches sent together are answered in order, one after another", async () => {
    const thread: NameAddressModelThread = await start("ok");
    const results: Array<ModelBatchResult> = await Promise.all([
      thread.run(batch([5])),
      thread.run(batch([1, 5])),
      thread.run(batch([1, 1, 5])),
    ]);

    expect(
      results.map((result: ModelBatchResult): number => {
        return result.logits.length / 9;
      }),
    ).toEqual([1, 2, 3]);
  });

  test("a model that cannot load is an error saying so, and the thread ends", async () => {
    await expect(start("fail")).rejects.toThrow(
      "The model could not load: Error: the model file is damaged",
    );
  });

  test("a model that never says it is ready is given up on", async () => {
    await expect(start("slowload", { loadTimeLimitInMs: 200 })).rejects.toThrow(
      "The model took too long to load.",
    );
  });

  test("a batch the model refuses is an error with its reason, and the thread goes on", async () => {
    const thread: NameAddressModelThread = await start("error");

    await expect(thread.run(batch([5]))).rejects.toThrow(
      "The model could not read a batch: Error: shapes do not match",
    );
    expect(thread.isRunning).toBe(true);
  });

  test("a batch that takes too long ends the thread, and later batches are refused", async () => {
    const thread: NameAddressModelThread = await start("hang", {
      runTimeLimitInMs: 200,
    });

    await expect(thread.run(batch([5]))).rejects.toThrow(
      "The model took too long on a batch.",
    );
    expect(thread.isRunning).toBe(false);
    await expect(thread.run(batch([5]))).rejects.toThrow(
      "The model's thread is not running.",
    );
  });

  test("a thread that ends while it reads fails the batch in flight", async () => {
    const thread: NameAddressModelThread = await start("exit");

    await expect(thread.run(batch([5]))).rejects.toThrow(
      "The model's thread ended.",
    );
    expect(thread.isRunning).toBe(false);
  });

  test("tells the scanner of every attempt to reach the network, by API", async () => {
    const attempts: Array<string> = [];

    await start("network", {
      onNetworkAttempt: (api: string): void => {
        attempts.push(api);
      },
    });

    expect(attempts).toEqual(["fetch"]);
  });

  test("closing is safe twice, and refuses batches after", async () => {
    const thread: NameAddressModelThread = await start("ok");

    await thread.close();
    await thread.close();
    await expect(thread.run(batch([5]))).rejects.toThrow(
      "The model's thread is not running.",
    );
  });
});

describe("the model's thread has no network", () => {
  test("every way out throws in the thread, and each attempt is reported by its API", async () => {
    const worker: Worker = new Worker(
      path.join(__dirname, "Fixtures", "TriesTheNetwork.cjs"),
      { workerData: { lockdownPath: LOCKDOWN } },
    );
    const answer: { results: Record<string, string>; reported: Array<string> } =
      await new Promise(
        (
          resolve: (value: {
            results: Record<string, string>;
            reported: Array<string>;
          }) => void,
          reject: (error: Error) => void,
        ) => {
          worker.once("message", resolve);
          worker.once("error", reject);
        },
      );

    await worker.terminate();

    for (const [api, result] of Object.entries(answer.results)) {
      expect({ api, result }).toEqual({ api, result: "refused" });
    }

    expect(Object.keys(answer.results)).toHaveLength(17);
    expect(answer.reported).toEqual(
      expect.arrayContaining([
        "fetch",
        "http.request",
        "https.get",
        "http2.connect",
        "net.connect",
        "net.Socket.connect",
        "tls.connect",
        "dns.lookup",
        "dns.promises.lookup",
        "dgram.createSocket",
        "child_process.spawn",
        "WebSocket",
      ]),
    );
  });

  test("the lockdown is the thread's own: this thread's network modules are untouched", async () => {
    const worker: Worker = new Worker(
      path.join(__dirname, "Fixtures", "TriesTheNetwork.cjs"),
      { workerData: { lockdownPath: LOCKDOWN } },
    );

    await new Promise((resolve: (value: unknown) => void) => {
      worker.once("message", resolve);
    });
    await worker.terminate();

    expect(http.request.name).not.toBe("refused");
    expect(net.connect.name).not.toBe("refused");
  });

  test("the model's worker locks the network down before it loads anything", () => {
    const worker: string = fs.readFileSync(
      NAME_ADDRESS_MODEL_WORKER_PATH,
      "utf8",
    );
    const lockdown: number = worker.indexOf("lockDownNetwork((api)");
    const runtime: number = worker.indexOf('require("onnxruntime-web")');

    expect(lockdown).toBeGreaterThan(-1);
    expect(runtime).toBeGreaterThan(lockdown);
    // Nothing but the lockdown and Node's own modules is required before it.
    expect(worker.slice(0, lockdown).match(/require\("[^"]+"\)/g)).toEqual([
      'require("worker_threads")',
      'require("fs")',
      'require("path")',
      'require("./NameAddressModelNetworkLockdown.cjs")',
    ]);
  });
});
