import {
  MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST,
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SESSION_REPLAY_MAX_FLUSH_FAILURES,
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SessionReplayChunkEnvelope,
  SessionReplayDirective,
} from "Common/Types/Rum/SessionReplay";
import OfflineStore, { OfflineChunk } from "../src/OfflineStore";
import Transport, {
  MAX_QUEUED_CHUNKS,
  MAX_QUEUED_PAYLOAD_CHARS,
  OFFLINE_POLL_MS,
  OFFLINE_RETRY_MS,
  RETRY_BACKOFF_MS,
} from "../src/Transport";
import {
  databaseNames,
  framesOfBody,
  freshIndexedDb,
  removeIndexedDb,
  resetBrowserOnline,
  setBrowserOnline,
  settle,
  testEnvelope,
} from "./OfflineTestUtils";

/*
 * Offline mode, at the transport: a device that loses its connection keeps
 * every chunk it records, costs itself no circuit-breaker strike for it, and
 * uploads the whole backlog - in order, exactly once - when the connection
 * returns. With an offline store, a tab closed while offline hands its
 * backlog to the next page of the application.
 */

const CHUNK_URL: string = "https://oneuptime.com/session-replay/v1/chunk";
const SCOPE: string = `${CHUNK_URL}#app-1`;

const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
  string,
  unknown
>;

function respond(
  status: number,
  body?: string,
  headers?: Record<string, string>,
): Response {
  return {
    status: status,
    headers: {
      get: (name: string): string | null => {
        return headers ? headers[name.toLowerCase()] || null : null;
      },
    },
    text: async (): Promise<string> => {
      return body || "";
    },
  } as unknown as Response;
}

/*
 * A network that can be switched off and on. While it is down every request
 * rejects the way a browser's fetch does when nothing answers; while it is
 * up the server answers with whatever `answer` returns.
 */
interface FakeNetwork {
  fetch: jest.Mock;
  setUp: (up: boolean) => void;
  answer: jest.Mock;
  postedIndexes: () => Array<number>;
  postedEnvelopes: () => Array<SessionReplayChunkEnvelope>;
}

function installNetwork(): FakeNetwork {
  let up: boolean = true;
  const answer: jest.Mock = jest.fn().mockImplementation((): Response => {
    return respond(202);
  });
  const delivered: Array<SessionReplayChunkEnvelope> = [];

  const fetchMock: jest.Mock = jest
    .fn()
    .mockImplementation(
      async (
        _url: string,
        init: Record<string, unknown>,
      ): Promise<Response> => {
        if (!up) {
          throw new TypeError("Failed to fetch");
        }

        const response: Response = answer() as Response;

        if (response.status >= 200 && response.status < 300) {
          for (const frame of framesOfBody(init["body"] as Uint8Array)) {
            delivered.push(frame.envelope);
          }
        }

        return response;
      },
    );

  globalRecord["fetch"] = fetchMock;

  return {
    fetch: fetchMock,
    setUp: (value: boolean): void => {
      up = value;
    },
    answer: answer,
    postedEnvelopes: (): Array<SessionReplayChunkEnvelope> => {
      return delivered;
    },
    postedIndexes: (): Array<number> => {
      return delivered.map((envelope: SessionReplayChunkEnvelope): number => {
        return envelope.chunkIndex;
      });
    },
  };
}

describe("Transport offline mode", (): void => {
  let transports: Array<Transport> = [];
  let permanentFailures: Array<string> = [];
  let directives: Array<SessionReplayDirective> = [];

  const makeTransport: (withStore?: boolean) => Transport = (
    withStore: boolean = false,
  ): Transport => {
    const transport: Transport = new Transport({
      url: CHUNK_URL,
      headers: { "x-oneuptime-token": "secret" },
      onDirective: (directive: SessionReplayDirective): void => {
        directives.push(directive);
      },
      onPermanentFailure: (reason: string): void => {
        permanentFailures.push(reason);
      },
      offlineStore: withStore ? new OfflineStore(SCOPE) : null,
    });

    transports.push(transport);

    return transport;
  };

  /* Every chunk the store would hand the next page, claimed on the way. */
  const storedIndexes: () => Promise<Array<number>> = async (): Promise<
    Array<number>
  > => {
    return (await new OfflineStore(SCOPE).takeAll()).map(
      (chunk: OfflineChunk): number => {
        return chunk.envelope.chunkIndex;
      },
    );
  };

  beforeEach((): void => {
    delete globalRecord["CompressionStream"];
    freshIndexedDb();
    window.localStorage.clear();
    setBrowserOnline(true);
    permanentFailures = [];
    directives = [];
  });

  afterEach((): void => {
    for (const transport of transports) {
      transport.discardQueue();
    }

    transports = [];
    resetBrowserOnline();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("a lost connection is not a failure", (): void => {
    it("costs no strike once the endpoint has answered, however long the outage lasts", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      expect(await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]")).toBe(
        true,
      );

      network.setUp(false);

      /* Two hours of a chunk every 15 s, and every retry the backoff runs. */
      for (let index: number = 1; index <= 480; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
        await jest.advanceTimersByTimeAsync(15_000);
      }

      expect(transport.isDisabled()).toBe(false);
      expect(permanentFailures).toEqual([]);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.isOffline()).toBe(true);
      expect(transport.getQueueDepth()).toBe(MAX_QUEUED_CHUNKS);
    });

    it("still counts a strike when the endpoint has NEVER answered, because a content blocker looks the same", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();

      network.setUp(false);

      const transport: Transport = makeTransport();

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[{}]");
      expect(transport.getFlushFailureCount()).toBe(1);

      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]!);
      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[1]!);

      expect(transport.getFlushFailureCount()).toBe(
        SESSION_REPLAY_MAX_FLUSH_FAILURES,
      );
      expect(transport.isDisabled()).toBe(true);
      expect(permanentFailures).toEqual(["max-flush-failures"]);
    });

    it("costs no strike when the browser itself says it is offline, even before any answer", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();

      network.setUp(false);
      setBrowserOnline(false);

      const transport: Transport = makeTransport();

      for (let index: number = 0; index < 20; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
        await jest.advanceTimersByTimeAsync(15_000);
      }

      expect(transport.isDisabled()).toBe(false);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.getQueueDepth()).toBe(20);
    });

    it("does not even try while the browser says it is offline", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      setBrowserOnline(false);

      for (let index: number = 0; index < 5; index++) {
        expect(
          await transport.send(testEnvelope({ chunkIndex: index }), "[{}]"),
        ).toBe(false);
      }

      /* Well past every retry and poll interval. */
      await jest.advanceTimersByTimeAsync(10 * 60_000);

      expect(network.fetch).not.toHaveBeenCalled();
      expect(transport.isOffline()).toBe(true);
      expect(transport.getQueueDepth()).toBe(5);
    });

    it("backs off gently while the connection stays down, settling at five minutes", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      network.setUp(false);
      await transport.send(testEnvelope({ chunkIndex: 1 }), "[1]");

      const waits: Array<number> = [];

      for (
        let attempt: number = 0;
        attempt < OFFLINE_RETRY_MS.length + 2;
        attempt++
      ) {
        const dueIn: number = transport.getRetryDueAtUnixMs() - Date.now();

        waits.push(dueIn);
        await jest.advanceTimersByTimeAsync(dueIn);
      }

      expect(waits).toEqual([
        ...OFFLINE_RETRY_MS,
        OFFLINE_RETRY_MS[OFFLINE_RETRY_MS.length - 1],
        OFFLINE_RETRY_MS[OFFLINE_RETRY_MS.length - 1],
      ]);
      expect(OFFLINE_RETRY_MS[OFFLINE_RETRY_MS.length - 1]).toBe(5 * 60_000);
    });

    it("re-checks navigator.onLine on a timer, so a missed online event still resumes", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      setBrowserOnline(false);
      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      await transport.send(testEnvelope({ chunkIndex: 1 }), "[1]");

      setBrowserOnline(true);

      /* No resume() call: only the poll. */
      await jest.advanceTimersByTimeAsync(OFFLINE_POLL_MS);

      expect(network.postedIndexes()).toEqual([0, 1]);
      expect(transport.getQueueDepth()).toBe(0);
    });
  });

  describe("coming back online", (): void => {
    it("uploads the whole backlog, in order, the moment the browser says it is back", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");

      setBrowserOnline(false);

      for (let index: number = 1; index <= 30; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), `[${index}]`);
      }

      expect(network.postedIndexes()).toEqual([0]);

      setBrowserOnline(true);
      transport.resume();
      await jest.advanceTimersByTimeAsync(0);

      expect(network.postedIndexes()).toEqual(
        Array.from({ length: 31 }, (_: unknown, index: number): number => {
          return index;
        }),
      );
      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.isOffline()).toBe(false);
      expect(transport.getDroppedChunkCount()).toBe(0);
    });

    it("ends an offline backoff early on resume, instead of waiting out five minutes", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      network.setUp(false);

      /* Deep into the backoff: the next retry is minutes away. */
      await transport.send(testEnvelope({ chunkIndex: 1 }), "[1]");

      for (let attempt: number = 0; attempt < 4; attempt++) {
        await jest.advanceTimersByTimeAsync(
          transport.getRetryDueAtUnixMs() - Date.now(),
        );
      }

      expect(transport.getRetryDueAtUnixMs() - Date.now()).toBeGreaterThan(
        60_000,
      );

      network.setUp(true);
      transport.resume();
      await jest.advanceTimersByTimeAsync(0);

      expect(network.postedIndexes()).toEqual([0, 1]);
    });

    it("keeps a server throttle in force even when the connection comes back", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      network.answer.mockImplementationOnce((): Response => {
        return respond(429, "", { "retry-after": "60" });
      });

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      expect(transport.isThrottled()).toBe(true);

      transport.resume();
      await jest.advanceTimersByTimeAsync(0);

      expect(network.postedIndexes()).toEqual([]);

      await jest.advanceTimersByTimeAsync(60_000);

      expect(network.postedIndexes()).toEqual([0]);
    });

    it("waits out a throttle hit mid-backlog without a strike and without losing a chunk", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      setBrowserOnline(false);

      for (let index: number = 1; index <= 10; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      /*
       * The first few chunks land, then the project's per-minute rate is
       * spent - every device came back at once - and the server throttles.
       */
      let answered: number = 0;

      network.answer.mockImplementation((): Response => {
        answered++;

        return answered === 4
          ? respond(429, "", { "retry-after": "30" })
          : respond(202);
      });

      setBrowserOnline(true);
      transport.resume();
      await jest.advanceTimersByTimeAsync(0);

      expect(network.postedIndexes()).toEqual([0, 1, 2, 3]);
      expect(transport.getQueueDepth()).toBe(7);

      await jest.advanceTimersByTimeAsync(30_000);

      expect(network.postedIndexes()).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.getDroppedChunkCount()).toBe(0);
    });

    it("stamps each chunk with when it was actually sent, so the server knows how long it waited", async (): Promise<void> => {
      jest.useFakeTimers();
      jest.setSystemTime(1_800_000_000_000);

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      await transport.send(
        testEnvelope({ chunkIndex: 0, clientSendUnixMs: Date.now() }),
        "[0]",
      );

      setBrowserOnline(false);

      const closedAt: number = Date.now();

      await transport.send(
        testEnvelope({ chunkIndex: 1, clientSendUnixMs: closedAt }),
        "[1]",
      );

      /* A two-hour flight. */
      jest.setSystemTime(closedAt + 2 * 60 * 60 * 1000);
      setBrowserOnline(true);
      transport.resume();
      await jest.advanceTimersByTimeAsync(0);

      const late: SessionReplayChunkEnvelope = network.postedEnvelopes()[1]!;

      expect(late.chunkIndex).toBe(1);
      expect(late.clientSendUnixMs).toBe(closedAt + 2 * 60 * 60 * 1000);
    });

    it("still stops for good on a 401 in the middle of the backlog", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport(true);

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      setBrowserOnline(false);

      for (let index: number = 1; index <= 5; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      await settle();

      network.answer.mockImplementation((): Response => {
        return respond(401);
      });

      setBrowserOnline(true);
      transport.resume();
      await jest.advanceTimersByTimeAsync(0);
      await settle();

      expect(transport.isDisabled()).toBe(true);
      expect(permanentFailures).toEqual(["http-401"]);
      /* Nothing held for an endpoint that refuses this recorder. */
      expect(transport.getQueueDepth()).toBe(0);
      expect(OfflineStore.hasPending()).toBe(false);
      expect(await storedIndexes()).toEqual([]);
    });

    it("honours a stop directive received while draining the backlog", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport();

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      setBrowserOnline(false);
      await transport.send(testEnvelope({ chunkIndex: 1 }), "[1]");

      network.answer.mockImplementation((): Response => {
        return respond(202, '{"directive":"stop","reason":"budget-exhausted"}');
      });

      setBrowserOnline(true);
      transport.resume();
      await jest.advanceTimersByTimeAsync(0);

      expect(directives).toContain("stop");
    });
  });

  describe("what the queue holds while it waits", (): void => {
    it("holds far more than one request's worth", async (): Promise<void> => {
      installNetwork();
      setBrowserOnline(false);

      const transport: Transport = makeTransport();

      for (let index: number = 0; index < 100; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      expect(100).toBeGreaterThan(MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST);
      expect(transport.getQueueDepth()).toBe(100);
      expect(transport.getDroppedChunkCount()).toBe(0);
    });

    it("drops the OLDEST chunks once it holds MAX_QUEUED_CHUNKS, and counts them", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();

      setBrowserOnline(false);

      const transport: Transport = makeTransport();

      for (let index: number = 0; index < MAX_QUEUED_CHUNKS + 7; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      expect(transport.getQueueDepth()).toBe(MAX_QUEUED_CHUNKS);
      expect(transport.getDroppedChunkCount()).toBe(7);

      setBrowserOnline(true);
      transport.resume();
      await jest.advanceTimersByTimeAsync(0);

      expect(network.postedIndexes()[0]).toBe(7);
      expect(network.postedIndexes()).toHaveLength(MAX_QUEUED_CHUNKS);
    });

    it("drops the oldest chunks once their payloads pass MAX_QUEUED_PAYLOAD_CHARS", async (): Promise<void> => {
      installNetwork();
      setBrowserOnline(false);

      const transport: Transport = makeTransport();
      const quarter: string = "x".repeat(MAX_QUEUED_PAYLOAD_CHARS / 4);

      for (let index: number = 0; index < 6; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), quarter);
      }

      expect(transport.getQueueDepth()).toBe(4);
      expect(transport.getDroppedChunkCount()).toBe(2);
    });

    it("always keeps the newest chunk, however large", async (): Promise<void> => {
      installNetwork();
      setBrowserOnline(false);

      const transport: Transport = makeTransport();

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[{}]");
      await transport.send(
        testEnvelope({ chunkIndex: 1 }),
        "x".repeat(MAX_QUEUED_PAYLOAD_CHARS + 1),
      );

      expect(transport.getQueueDepth()).toBe(1);
      expect(transport.getDroppedChunkCount()).toBe(1);
    });

    it("keeps an outage survivable in memory when there is no IndexedDB at all", async (): Promise<void> => {
      jest.useFakeTimers();
      removeIndexedDb();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport(true);

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      setBrowserOnline(false);

      for (let index: number = 1; index <= 3; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      await settle();

      setBrowserOnline(true);
      transport.resume();
      await jest.advanceTimersByTimeAsync(0);
      await settle();
      await jest.advanceTimersByTimeAsync(0);

      expect(network.postedIndexes()).toEqual([0, 1, 2, 3]);
    });
  });

  describe("persisting what waits", (): void => {
    it("writes every chunk that has to wait to IndexedDB", async (): Promise<void> => {
      installNetwork();
      setBrowserOnline(false);

      const transport: Transport = makeTransport(true);

      for (let index: number = 0; index < 4; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      await settle();

      expect(OfflineStore.hasPending()).toBe(true);
      expect(await storedIndexes()).toEqual([0, 1, 2, 3]);
    });

    it("forgets each stored chunk once it is uploaded", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();

      setBrowserOnline(false);

      const transport: Transport = makeTransport(true);

      for (let index: number = 0; index < 4; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      await settle();

      setBrowserOnline(true);
      transport.resume();

      for (let round: number = 0; round < 6; round++) {
        await jest.advanceTimersByTimeAsync(0);
        await settle();
      }

      expect(network.postedIndexes()).toEqual([0, 1, 2, 3]);
      expect(await storedIndexes()).toEqual([]);
      expect(OfflineStore.hasPending()).toBe(false);
    });

    it("forgets the chunks it had to drop for space", async (): Promise<void> => {
      installNetwork();
      setBrowserOnline(false);

      const transport: Transport = makeTransport(true);

      for (let index: number = 0; index < MAX_QUEUED_CHUNKS + 3; index++) {
        await transport.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      await settle();

      const stored: Array<number> = await storedIndexes();

      expect(stored).toHaveLength(MAX_QUEUED_CHUNKS);
      expect(stored[0]).toBe(3);
    });

    it("writes nothing to disk when offline storage is off", async (): Promise<void> => {
      installNetwork();
      setBrowserOnline(false);

      const transport: Transport = makeTransport(false);

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[{}]");
      transport.sendTerminal([
        {
          envelope: testEnvelope({ chunkIndex: 1, isFinal: true }),
          payload: "[]",
        },
      ]);
      await settle();

      expect(await databaseNames()).toEqual([]);
      expect(OfflineStore.hasPending()).toBe(false);
    });

    it("clears the store when the queue is discarded (consent withdrawn, server stop)", async (): Promise<void> => {
      installNetwork();
      setBrowserOnline(false);

      const transport: Transport = makeTransport(true);

      await transport.send(testEnvelope({ chunkIndex: 0 }), "[{}]");
      await settle();

      transport.discardQueue();
      await settle();

      expect(transport.getQueueDepth()).toBe(0);
      expect(OfflineStore.hasPending()).toBe(false);
      expect(await storedIndexes()).toEqual([]);
    });
  });

  /*
   * pagehide while offline. The keepalive request would fail like every
   * other request, so the page's last chunks go to IndexedDB instead - from
   * inside the handler - and the next page of the application sends them.
   */
  describe("a page closed while offline", (): void => {
    const pageExit: (transport: Transport) => boolean = (
      transport: Transport,
    ): boolean => {
      /* A split: two older pieces and the sealing one, over the quota together. */
      return transport.sendTerminal([
        {
          envelope: testEnvelope({ chunkIndex: 4 }),
          payload: `["${"a".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES / 2)}"]`,
        },
        {
          envelope: testEnvelope({ chunkIndex: 5 }),
          payload: `["${"b".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES / 2)}"]`,
        },
        {
          envelope: testEnvelope({ chunkIndex: 6, isFinal: true }),
          payload: `["${"c".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES)}"]`,
        },
      ]);
    };

    it("stores every piece instead of posting a request that cannot leave", async (): Promise<void> => {
      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport(true);

      setBrowserOnline(false);
      transport.prepareForOffline();
      await settle();

      expect(pageExit(transport)).toBe(true);
      expect(network.fetch).not.toHaveBeenCalled();

      await settle();

      const stored: Array<OfflineChunk> = await new OfflineStore(
        SCOPE,
      ).takeAll();

      expect(
        stored.map((chunk: OfflineChunk): number => {
          return chunk.envelope.chunkIndex;
        }),
      ).toEqual([4, 5, 6]);

      /* Whole: nothing emptied or dropped to fit a keepalive quota. */
      expect(stored[2]?.envelope.isFinal).toBe(true);
      expect(stored[2]?.payload.length).toBeGreaterThan(
        SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
      );
      expect(transport.getDroppedChunkCount()).toBe(0);
    });

    it("writes inside the handler once the store is open, so a closing tab loses nothing", async (): Promise<void> => {
      installNetwork();

      const transport: Transport = makeTransport(true);

      setBrowserOnline(false);
      transport.prepareForOffline();
      await settle();

      const put: jest.SpyInstance = jest.spyOn(OfflineStore.prototype, "put");
      const transaction: jest.SpyInstance = jest.spyOn(
        IDBDatabase.prototype,
        "transaction",
      );

      pageExit(transport);

      /* Issued synchronously, before this handler returns. */
      expect(put).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it("hands the whole recording to the next page load, which uploads it in order", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();

      /* Page one: chunk 0 lands, then the train enters the tunnel. */
      const pageOne: Transport = makeTransport(true);

      await pageOne.send(testEnvelope({ chunkIndex: 0 }), "[0]");

      network.setUp(false);
      setBrowserOnline(false);

      for (let index: number = 1; index <= 3; index++) {
        await pageOne.send(testEnvelope({ chunkIndex: index }), `[${index}]`);
      }

      await settle();
      pageExit(pageOne);
      await settle();

      expect(network.postedIndexes()).toEqual([0]);

      /* Page two, the next day, with a connection. */
      network.setUp(true);
      setBrowserOnline(true);

      const pageTwo: Transport = makeTransport(true);

      expect(await pageTwo.restorePersisted()).toBe(6);

      for (let round: number = 0; round < 8; round++) {
        await jest.advanceTimersByTimeAsync(0);
        await settle();
      }

      expect(network.postedIndexes()).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(network.postedEnvelopes()[6]?.isFinal).toBe(true);
      expect(pageTwo.getQueueDepth()).toBe(0);
      expect(OfflineStore.hasPending()).toBe(false);
    });

    it("uploads an earlier page's chunks ahead of this page's own", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();

      new OfflineStore(SCOPE).put([
        {
          envelope: testEnvelope({ chunkIndex: 8, tabId: "c".repeat(32) }),
          payload: "[]",
        },
      ]);
      await settle();

      setBrowserOnline(false);

      const page: Transport = makeTransport(true);

      await page.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      setBrowserOnline(true);

      await page.restorePersisted();

      for (let round: number = 0; round < 6; round++) {
        await jest.advanceTimersByTimeAsync(0);
        await settle();
      }

      const posted: Array<SessionReplayChunkEnvelope> =
        network.postedEnvelopes();

      expect(posted[0]?.tabId).toBe("c".repeat(32));
      expect(posted[1]?.chunkIndex).toBe(0);
    });

    it("never opens IndexedDB on a page load when no earlier page left anything", async (): Promise<void> => {
      installNetwork();

      const open: jest.SpyInstance = jest.spyOn(indexedDB, "open");
      const page: Transport = makeTransport(true);

      expect(await page.restorePersisted()).toBe(0);
      expect(open).not.toHaveBeenCalled();
      expect(await databaseNames()).toEqual([]);
    });

    it("never uploads a stored chunk older than the offline delay", async (): Promise<void> => {
      const network: FakeNetwork = installNetwork();
      const nowSpy: jest.SpyInstance = jest.spyOn(Date, "now");

      nowSpy.mockReturnValue(1_700_000_000_000);
      new OfflineStore(SCOPE).put([
        { envelope: testEnvelope({ chunkIndex: 1 }), payload: "[]" },
      ]);
      await settle();

      nowSpy.mockReturnValue(
        1_700_000_000_000 + SESSION_REPLAY_MAX_OFFLINE_DELAY_MS + 1,
      );

      expect(await makeTransport(true).restorePersisted()).toBe(0);
      await settle();
      expect(network.fetch).not.toHaveBeenCalled();
    });

    it("stores what the keepalive quota could not carry, rather than dropping it", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const transport: Transport = makeTransport(true);

      /* A throttle leaves eight large chunks queued (and stored). */
      network.answer.mockImplementationOnce((): Response => {
        return respond(429, "", { "retry-after": "120" });
      });

      for (let index: number = 0; index < 8; index++) {
        await transport.send(
          testEnvelope({ chunkIndex: index }),
          `["${"q".repeat(20 * 1024)}"]`,
        );
      }

      await settle();

      /* Online pagehide: one keepalive request, and it cannot carry all. */
      transport.sendTerminal([
        {
          envelope: testEnvelope({ chunkIndex: 8, isFinal: true }),
          payload: "[]",
        },
      ]);
      await settle();

      expect(network.fetch).toHaveBeenCalledTimes(2);

      const keepalive: Record<string, unknown> = network.fetch.mock
        .calls[1]?.[1] as Record<string, unknown>;

      expect(keepalive["keepalive"]).toBe(true);

      const sent: Array<number> = framesOfBody(
        keepalive["body"] as Uint8Array,
      ).map((frame: { envelope: SessionReplayChunkEnvelope }): number => {
        return frame.envelope.chunkIndex;
      });

      expect(sent).toContain(8);
      expect(transport.getDroppedChunkCount()).toBe(0);

      /* The rest is still stored, and the sent ones are not. */
      const stored: Array<number> = await storedIndexes();

      expect(stored.length).toBeGreaterThan(0);
      expect(stored.length + sent.length).toBe(9);

      for (const index of sent) {
        expect(stored).not.toContain(index);
      }
    });
  });

  /*
   * Two tabs of one application share IndexedDB. The tab that stored a
   * chunk still holds it in memory; a tab that loads later claims it from
   * the store. Exactly one of them may send it.
   */
  describe("two tabs, one backlog", (): void => {
    it("never uploads a stored chunk twice", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();
      const tabA: Transport = makeTransport(true);

      await tabA.send(testEnvelope({ chunkIndex: 0 }), "[0]");
      setBrowserOnline(false);

      for (let index: number = 1; index <= 5; index++) {
        await tabA.send(testEnvelope({ chunkIndex: index }), "[{}]");
      }

      await settle();

      /* The connection returns; the user opens tab B before A retries. */
      setBrowserOnline(true);

      const tabB: Transport = makeTransport(true);

      await tabB.restorePersisted();

      /* ...and then tab A hears the online event too. */
      tabA.resume();

      for (let round: number = 0; round < 10; round++) {
        await jest.advanceTimersByTimeAsync(0);
        await settle();
      }

      const posted: Array<number> = network
        .postedIndexes()
        .slice()
        .sort((left: number, right: number): number => {
          return left - right;
        });

      expect(posted).toEqual([0, 1, 2, 3, 4, 5]);
      expect(tabA.getQueueDepth()).toBe(0);
      expect(tabB.getQueueDepth()).toBe(0);
    });

    it("stores a restored chunk again when its upload fails, for whichever page comes next", async (): Promise<void> => {
      jest.useFakeTimers();

      const network: FakeNetwork = installNetwork();

      new OfflineStore(SCOPE).put([
        { envelope: testEnvelope({ chunkIndex: 2 }), payload: "[2]" },
      ]);
      await settle();

      /* Page two loads on a connection that goes nowhere (a captive portal). */
      network.setUp(false);

      const pageTwo: Transport = makeTransport(true);

      await pageTwo.restorePersisted();

      for (let round: number = 0; round < 4; round++) {
        await jest.advanceTimersByTimeAsync(0);
        await settle();
      }

      expect(network.postedIndexes()).toEqual([]);

      /* Page two is closed; page three, on a real connection, gets it. */
      pageTwo.discardQueue = (): void => {
        /* A closed tab discards nothing: its memory simply goes. */
      };

      network.setUp(true);

      const pageThree: Transport = makeTransport(true);

      expect(await pageThree.restorePersisted()).toBe(1);

      for (let round: number = 0; round < 4; round++) {
        await jest.advanceTimersByTimeAsync(0);
        await settle();
      }

      expect(network.postedIndexes()).toEqual([2]);
    });
  });
});
