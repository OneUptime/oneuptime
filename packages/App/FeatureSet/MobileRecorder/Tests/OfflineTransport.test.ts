import { strFromU8 } from "fflate";
import { SessionReplayChunkEnvelope } from "../src/Contract";
import {
  ReplayFetch,
  validateStartOptions,
  ValidatedStartOptions,
} from "../src/Config";
import ReplayOutbox, { OutboxEntry, PersistedReplayFrame } from "../src/Outbox";
import ReplayTransport, { OFFLINE_RETRY_MS } from "../src/Transport";
import { envelope, MemoryStorage, response, startOptions } from "./TestUtils";

/*
 * Offline mode, at the mobile transport: a device that loses its connection
 * keeps every frame, spends none of a frame's attempts on the outage, and
 * uploads the whole backlog - in order - when the connection returns.
 */

type ReplayFetchInit = NonNullable<Parameters<ReplayFetch>[1]>;

interface FakeNetwork {
  fetch: jest.MockedFunction<ReplayFetch>;
  setUp(up: boolean): void;
  answer: jest.Mock;
  postedIndexes(): Array<number>;
  postedEnvelopes(): Array<SessionReplayChunkEnvelope>;
}

function installNetwork(): FakeNetwork {
  let up: boolean = true;
  const delivered: Array<SessionReplayChunkEnvelope> = [];
  const answer: jest.Mock = jest.fn(() => {
    return response(202, { directive: "continue", configEpoch: 1 });
  });
  const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
    async (_url: string, init: ReplayFetchInit = {}) => {
      if (!up) {
        throw new TypeError("Network request failed");
      }
      const answered: ReturnType<typeof response> = answer();
      if (answered.status >= 200 && answered.status < 300) {
        const body: Uint8Array = init.body as Uint8Array;
        delivered.push(
          JSON.parse(
            strFromU8(body.slice(0, body.indexOf(10))),
          ) as SessionReplayChunkEnvelope,
        );
      }
      return answered;
    },
  );

  return {
    fetch,
    setUp(value: boolean): void {
      up = value;
    },
    answer,
    postedEnvelopes(): Array<SessionReplayChunkEnvelope> {
      return delivered;
    },
    postedIndexes(): Array<number> {
      return delivered.map((item: SessionReplayChunkEnvelope): number => {
        return item.chunkIndex;
      });
    },
  };
}

describe("mobile transport offline mode", () => {
  let transports: Array<ReplayTransport> = [];
  let diagnostics: Array<string> = [];

  const makeTransport: (
    network: FakeNetwork,
    outbox: ReplayOutbox,
  ) => ReplayTransport = (
    network: FakeNetwork,
    outbox: ReplayOutbox,
  ): ReplayTransport => {
    const validated: ValidatedStartOptions = validateStartOptions(
      startOptions({ fetch: network.fetch }),
    )!;
    const transport: ReplayTransport = new ReplayTransport({
      startOptions: validated,
      outbox,
      onDirective: jest.fn(),
      onDiagnostic: (code: string): void => {
        diagnostics.push(code);
      },
    });
    transports.push(transport);
    return transport;
  };

  /* Enough turns for storage, gzip and the post to finish. */
  const flush: () => Promise<void> = async (): Promise<void> => {
    await jest.advanceTimersByTimeAsync(0);
  };

  const attemptsOf: (outbox: ReplayOutbox) => Promise<Array<number>> = async (
    outbox: ReplayOutbox,
  ): Promise<Array<number>> => {
    return (await outbox.entries()).map((entry: OutboxEntry): number => {
      return entry.attempts;
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    diagnostics = [];
  });

  afterEach(() => {
    for (const transport of transports) {
      transport.destroy();
    }
    transports = [];
    jest.useRealTimers();
  });

  test("keeps every frame through an outage and spends none of their attempts", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    network.setUp(false);

    /* Twenty minutes: a frame every 15 s, and every retry in between. */
    for (let index: number = 0; index < 80; index += 1) {
      await transport.enqueue(envelope({ chunkIndex: index }), "[{}]");
      await jest.advanceTimersByTimeAsync(15_000);
    }

    expect(network.postedIndexes()).toEqual([]);
    expect(await outbox.entries()).toHaveLength(80);
    expect(new Set(await attemptsOf(outbox))).toEqual(new Set([0]));
    expect(transport.isOffline()).toBe(true);
    expect(diagnostics).not.toContain("chunk-retry-exhausted");

    network.setUp(true);
    await jest.advanceTimersByTimeAsync(
      OFFLINE_RETRY_MS[OFFLINE_RETRY_MS.length - 1]!,
    );

    expect(network.postedIndexes()).toEqual(
      Array.from({ length: 80 }, (_: unknown, index: number): number => {
        return index;
      }),
    );
    expect(await outbox.entries()).toEqual([]);
    expect(transport.isOffline()).toBe(false);
    expect(diagnostics).toContain("back-online");
  });

  test("retries after 5 s, 15 s, 30 s and then every minute, however long it lasts", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    network.setUp(false);
    await transport.enqueue(envelope({ chunkIndex: 0 }), "[{}]");
    expect(network.fetch).toHaveBeenCalledTimes(1);

    const waits: Array<number> = [
      5_000, 15_000, 30_000, 60_000, 60_000, 60_000,
    ];
    for (const wait of waits) {
      await jest.advanceTimersByTimeAsync(wait - 1);
      const before: number = network.fetch.mock.calls.length;
      await jest.advanceTimersByTimeAsync(1);
      expect(network.fetch.mock.calls.length).toBe(before + 1);
    }

    expect(OFFLINE_RETRY_MS).toEqual([5_000, 15_000, 30_000, 60_000]);
  });

  test("does not post each new frame into the outage; the retry timer does", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    network.setUp(false);
    await transport.enqueue(envelope({ chunkIndex: 0 }), "[{}]");
    expect(network.fetch).toHaveBeenCalledTimes(1);

    /* Three frames inside the first 5 s backoff: stored, not posted. */
    for (let index: number = 1; index <= 3; index += 1) {
      await transport.enqueue(envelope({ chunkIndex: index }), "[{}]");
    }

    expect(network.fetch).toHaveBeenCalledTimes(1);
    expect(await outbox.entries()).toHaveLength(4);
  });

  test("a connectivity source saying offline stops every attempt; online drains at once", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    transport.setConnectivity(false);

    for (let index: number = 0; index < 5; index += 1) {
      await transport.enqueue(envelope({ chunkIndex: index }), "[{}]");
    }
    await jest.advanceTimersByTimeAsync(10 * 60_000);

    /* The network is actually up; the device said it was not. */
    expect(network.fetch).not.toHaveBeenCalled();
    expect(transport.isOffline()).toBe(true);

    /* Coming back only clears the way; the recorder decides to resume. */
    transport.setConnectivity(true);
    await flush();
    expect(network.fetch).not.toHaveBeenCalled();

    transport.resume();
    await flush();

    expect(network.postedIndexes()).toEqual([0, 1, 2, 3, 4]);
  });

  test("an unknown connectivity state blocks nothing", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    transport.setConnectivity(null);
    await transport.enqueue(envelope({ chunkIndex: 0 }), "[{}]");

    expect(network.postedIndexes()).toEqual([0]);
  });

  test("resume ends an offline backoff early", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    network.setUp(false);
    await transport.enqueue(envelope({ chunkIndex: 0 }), "[{}]");
    await jest.advanceTimersByTimeAsync(5_000 + 15_000 + 30_000);

    /* A minute from the next retry. */
    network.setUp(true);
    transport.resume();
    await flush();

    expect(network.postedIndexes()).toEqual([0]);
  });

  test("resume keeps a server throttle in force", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    network.answer.mockImplementationOnce(() => {
      return response(429, {}, { "retry-after": "60" });
    });
    await transport.enqueue(envelope({ chunkIndex: 0 }), "[{}]");

    transport.resume();
    await flush();
    expect(network.postedIndexes()).toEqual([]);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(network.postedIndexes()).toEqual([0]);
  });

  test("a throttle while the backlog drains costs no attempts and loses nothing", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    network.setUp(false);
    for (let index: number = 0; index < 6; index += 1) {
      await transport.enqueue(envelope({ chunkIndex: index }), "[{}]");
    }

    /* Every device of the fleet reconnects at once; the project's rate is spent. */
    let answered: number = 0;
    network.answer.mockImplementation(() => {
      answered += 1;
      return answered === 3 || answered === 4
        ? response(429, {}, { "retry-after": "20" })
        : response(202, { directive: "continue" });
    });

    network.setUp(true);
    transport.resume();
    await flush();

    expect(network.postedIndexes()).toEqual([0, 1]);
    expect(await attemptsOf(outbox)).toEqual([0, 0, 0, 0]);

    await jest.advanceTimersByTimeAsync(20_000);
    await jest.advanceTimersByTimeAsync(20_000);

    expect(network.postedIndexes()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(diagnostics).not.toContain("chunk-retry-exhausted");
  });

  test("a server that answers with a bare 5xx still spends attempts and gives up on that frame", async () => {
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);

    network.answer.mockImplementation(() => {
      return response(500);
    });
    await transport.enqueue(envelope({ chunkIndex: 0 }), "[{}]");
    await jest.advanceTimersByTimeAsync(15_000);
    await jest.advanceTimersByTimeAsync(15_000);

    expect(diagnostics).toContain("chunk-retry-exhausted");
    expect(await outbox.entries()).toEqual([]);
  });

  test("stamps each frame with when it was actually sent, not when it was recorded", async () => {
    jest.setSystemTime(1_800_000_000_000);
    const network: FakeNetwork = installNetwork();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    const transport: ReplayTransport = makeTransport(network, outbox);
    const recordedAt: number = Date.now();

    network.setUp(false);
    await transport.enqueue(
      envelope({ chunkIndex: 0, clientSendUnixMs: recordedAt }),
      "[{}]",
    );

    /* A three-hour flight. */
    jest.setSystemTime(recordedAt + 3 * 60 * 60 * 1000);
    network.setUp(true);
    transport.resume();
    await flush();

    expect(network.postedEnvelopes()[0]?.clientSendUnixMs).toBe(
      recordedAt + 3 * 60 * 60 * 1000,
    );
  });

  test("a relaunched app uploads the backlog the killed one left in storage", async () => {
    const network: FakeNetwork = installNetwork();
    const storage: MemoryStorage = new MemoryStorage();

    network.setUp(false);
    const killed: ReplayTransport = makeTransport(
      network,
      new ReplayOutbox(storage, "app"),
    );
    for (let index: number = 0; index < 4; index += 1) {
      await killed.enqueue(envelope({ chunkIndex: index }), `[{"n":${index}}]`);
    }
    killed.destroy();

    network.setUp(true);
    const relaunched: ReplayTransport = makeTransport(
      network,
      new ReplayOutbox(storage, "app"),
    );
    await relaunched.restore();

    expect(network.postedIndexes()).toEqual([0, 1, 2, 3]);
    expect(storage.values.size).toBe(0);
  });

  test("posts the stored gzip bytes, byte for byte what was recorded", async () => {
    const network: FakeNetwork = installNetwork();
    const storage: MemoryStorage = new MemoryStorage();
    const outbox: ReplayOutbox = new ReplayOutbox(storage, "app");
    const transport: ReplayTransport = makeTransport(network, outbox);
    const payload: string = JSON.stringify([{ type: 2, data: { text: "é✓" } }]);

    network.setUp(false);
    await transport.enqueue(envelope({ chunkIndex: 0 }), payload);

    const stored: Array<PersistedReplayFrame> = await outbox.list();
    expect(stored[0]?.payload).toBe(payload);

    network.setUp(true);
    transport.resume();
    await flush();

    const posted: Uint8Array = network.fetch.mock.calls[1]?.[1]
      ?.body as Uint8Array;
    const { gunzipSync } =
      jest.requireActual<typeof import("fflate")>("fflate");
    expect(strFromU8(gunzipSync(posted.slice(posted.indexOf(10) + 1)))).toBe(
      payload,
    );
  });
});
