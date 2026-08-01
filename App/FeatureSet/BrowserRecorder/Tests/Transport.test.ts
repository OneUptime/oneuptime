import {
  SESSION_REPLAY_CONTENT_TYPE,
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SessionReplayChunkEnvelope,
  SessionReplayDirective,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import Chunker from "../src/Chunker";
import Transport, { CompressionResult } from "../src/Transport";

describe("Transport", (): void => {
  const envelope: SessionReplayChunkEnvelope = {
    v: 1,
    appIdentifier: "app-1",
    sessionId: "a".repeat(32),
    tabId: "b".repeat(32),
    chunkIndex: 0,
    sessionStartUnixMs: 1_700_000_000_000,
    clientSendUnixMs: 1_700_000_015_000,
    chunkStartOffsetMs: 0,
    chunkEndOffsetMs: 15_000,
    eventCount: 12,
    hasFullSnapshot: true,
    isFinal: false,
    recorderKind: "dom",
    schemaVersion: 1,
    rrwebVersion: "2.1.1",
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "Granted",
    triggerReason: SessionReplayTriggerReason.Error,
    payloadEncoding: "identity",
    payloadBytes: 0,
    url: "https://shop.example.com/checkout",
    signals: Chunker.emptySignals(),
    fidelityNotices: [],
    droppedEvents: 0,
    flushFailures: 0,
  };

  let directives: Array<SessionReplayDirective> = [];
  let permanentFailures: Array<string> = [];

  const makeTransport: () => Transport = (): Transport => {
    directives = [];
    permanentFailures = [];

    return new Transport({
      url: "https://oneuptime.com/session-replay/v1/chunk",
      headers: {
        "x-oneuptime-token": "secret",
        "x-oneuptime-app-identifier": "app-1",
      },
      onDirective: (directive: SessionReplayDirective): void => {
        directives.push(directive);
      },
      onPermanentFailure: (reason: string): void => {
        permanentFailures.push(reason);
      },
    });
  };

  const respond: (
    status: number,
    body?: string,
    headers?: Record<string, string>,
  ) => Response = (
    status: number,
    body?: string,
    headers?: Record<string, string>,
  ): Response => {
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
  };

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  describe("compress", (): void => {
    it("gzips when CompressionStream exists", async (): Promise<void> => {
      if (
        typeof (globalThis as unknown as Record<string, unknown>)[
          "CompressionStream"
        ] !== "function"
      ) {
        /*
         * jsdom has no CompressionStream, which is exactly the fallback path
         * asserted below. The gzip branch is exercised by the E2E fixtures.
         */
        return;
      }

      const result: CompressionResult = await Transport.compress("hello");

      expect(result.encoding).toBe("gzip");
    });

    /*
     * The fallback is identity, never raw DEFLATE. The server's whole decode
     * vocabulary is gzip-or-none, so deflate bytes would be stored as garbage.
     */
    it("falls back to identity, never deflate", async (): Promise<void> => {
      const globalRecord: Record<string, unknown> =
        globalThis as unknown as Record<string, unknown>;
      const original: unknown = globalRecord["CompressionStream"];

      delete globalRecord["CompressionStream"];

      const result: CompressionResult = await Transport.compress("hello");

      expect(result.encoding).toBe("identity");
      expect(new TextDecoder().decode(result.bytes)).toBe("hello");

      if (original !== undefined) {
        globalRecord["CompressionStream"] = original;
      }
    });

    /*
     * The write and close promises are not awaited (awaiting write() before
     * close() deadlocks until the readable side is drained), but they must
     * still be HANDLED. A discarded rejection surfaces as `unhandledrejection`
     * on the customer's page, where their own error tracker reports it as
     * their bug - and where the recorder's own ErrorRecorder catches it and
     * treats it as a reason to start uploading.
     */
    it("never leaks an unhandled rejection when the stream errors", async (): Promise<void> => {
      const globalRecord: Record<string, unknown> =
        globalThis as unknown as Record<string, unknown>;
      const original: unknown = globalRecord["CompressionStream"];

      const rejections: Array<unknown> = [];
      const onRejection: (event: Event) => void = (event: Event): void => {
        rejections.push(event);
      };

      window.addEventListener("unhandledrejection", onRejection);

      /*
       * A writer whose write() and close() both reject, which is what a
       * CompressionStream in an errored state does.
       */
      globalRecord["CompressionStream"] = function BrokenCompressionStream(): {
        writable: { getWriter: () => unknown };
        readable: unknown;
      } {
        return {
          writable: {
            getWriter: (): unknown => {
              return {
                write: async (): Promise<void> => {
                  throw new Error("stream errored");
                },
                close: async (): Promise<void> => {
                  throw new Error("stream errored");
                },
              };
            },
          },
          readable: null,
        };
      };

      const result: CompressionResult = await Transport.compress("hello");

      /* The real failure is still observed, and falls back to identity. */
      expect(result.encoding).toBe("identity");
      expect(new TextDecoder().decode(result.bytes)).toBe("hello");

      /* Let any unhandled rejection reach the loop before asserting. */
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });

      expect(rejections).toEqual([]);

      window.removeEventListener("unhandledrejection", onRejection);

      if (original === undefined) {
        delete globalRecord["CompressionStream"];
      } else {
        globalRecord["CompressionStream"] = original;
      }
    });
  });

  describe("buildBody", (): void => {
    it("puts the envelope before a single newline, then the payload", (): void => {
      const payload: Uint8Array<ArrayBuffer> = new TextEncoder().encode("[{}]");

      const body: Uint8Array<ArrayBuffer> = Transport.buildBody(
        envelope,
        payload,
      );

      const text: string = new TextDecoder().decode(body);
      const newlineIndex: number = text.indexOf("\n");

      expect(newlineIndex).toBeGreaterThan(0);
      expect(JSON.parse(text.slice(0, newlineIndex))).toMatchObject({
        sessionId: envelope.sessionId,
        tabId: envelope.tabId,
      });
      expect(text.slice(newlineIndex + 1)).toBe("[{}]");
    });
  });

  describe("send", (): void => {
    it("posts with the auth and app identifier headers and the vendor content type", async (): Promise<void> => {
      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValue(respond(202, '{"directive":"continue"}'));

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const transport: Transport = makeTransport();

      expect(await transport.send(envelope, "[{}]")).toBe(true);

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;
      const headers: Record<string, string> = init["headers"] as Record<
        string,
        string
      >;

      expect(headers["x-oneuptime-token"]).toBe("secret");
      expect(headers["x-oneuptime-app-identifier"]).toBe("app-1");
      expect(headers["Content-Type"]).toBe(SESSION_REPLAY_CONTENT_TYPE);
      expect(init["credentials"]).toBe("omit");
      expect(directives).toEqual(["continue"]);
    });

    /*
     * Content-Encoding must be truthful. Claiming gzip on identity bytes makes
     * the worker hand garbage to gunzip.
     */
    it("omits Content-Encoding when the payload was not compressed", async (): Promise<void> => {
      const globalRecord: Record<string, unknown> =
        globalThis as unknown as Record<string, unknown>;
      const originalCompression: unknown = globalRecord["CompressionStream"];

      delete globalRecord["CompressionStream"];

      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));
      globalRecord["fetch"] = fetchMock;

      await makeTransport().send(envelope, "[{}]");

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;
      const headers: Record<string, string> = init["headers"] as Record<
        string,
        string
      >;

      expect(headers["Content-Encoding"]).toBeUndefined();

      if (originalCompression !== undefined) {
        globalRecord["CompressionStream"] = originalCompression;
      }
    });

    it("reports the stop directive so a live recorder shuts down", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(204, '{"directive":"stop"}'));

      await makeTransport().send(envelope, "[{}]");

      expect(directives).toEqual(["stop"]);
    });
  });

  describe("error handling", (): void => {
    it("permanently disables on 401 and 403", async (): Promise<void> => {
      for (const status of [401, 403]) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
          .fn()
          .mockResolvedValue(respond(status));

        const transport: Transport = makeTransport();

        expect(await transport.send(envelope, "[{}]")).toBe(false);
        expect(transport.isDisabled()).toBe(true);
        expect(permanentFailures).toEqual([`http-${status}`]);
      }
    });

    /*
     * A rejected chunk is the chunk's problem, not the transport's, so it must
     * not push the circuit breaker toward self-disabling.
     */
    it("drops a 413 chunk without counting a transport failure", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(413));

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");
      await transport.send(envelope, "[{}]");
      await transport.send(envelope, "[{}]");

      expect(transport.isDisabled()).toBe(false);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.getDroppedChunkCount()).toBe(3);
    });

    it("throttles on 429 using Retry-After and does not count a failure", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(429, "", { "retry-after": "60" }));

      const transport: Transport = makeTransport();

      expect(await transport.send(envelope, "[{}]")).toBe(false);
      expect(transport.isThrottled()).toBe(true);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.getQueueDepth()).toBe(1);
    });

    it("self-disables after three consecutive retryable failures", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(503));

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");
      expect(transport.isDisabled()).toBe(false);

      await transport.send(envelope, "[{}]");
      await transport.send(envelope, "[{}]");

      expect(transport.isDisabled()).toBe(true);
      expect(transport.getDisabledReason()).toBe("max-flush-failures");
      expect(permanentFailures).toEqual(["max-flush-failures"]);
    });

    it("counts a network rejection as retryable", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockRejectedValue(new Error("offline"));

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");

      expect(transport.getFlushFailureCount()).toBe(1);
      expect(transport.getQueueDepth()).toBe(1);
    });

    /*
     * The retry queue holds up to MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST fully
     * serialised chunks of end-user page content. disable() clears it, but
     * revokeConsent() and stop() do not go through disable(), so the "revoke
     * drops the buffer" contract used to hold for the ring buffer and not for
     * the part already handed to the transport.
     */
    it("drops queued chunks on discardQueue", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockRejectedValue(new Error("offline"));

      const transport: Transport = makeTransport();

      await transport.send(envelope, '[{"secret":"page content"}]');

      expect(transport.getQueueDepth()).toBe(1);

      transport.discardQueue();

      expect(transport.getQueueDepth()).toBe(0);

      /* And nothing resurrects it: the next send posts only its own chunk. */
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));
      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      await transport.send(envelope, "[{}]");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        new TextDecoder().decode(
          fetchMock.mock.calls[0]?.[1]?.body as Uint8Array,
        ),
      ).not.toContain("page content");
    });

    it("resets the failure count after a success", async (): Promise<void> => {
      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValueOnce(respond(503))
        .mockResolvedValue(respond(202));

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");
      expect(transport.getFlushFailureCount()).toBe(1);

      await transport.send(envelope, "[{}]");
      expect(transport.getFlushFailureCount()).toBe(0);
    });

    it("stops accepting chunks once disabled", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(401));

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");

      expect(await transport.send(envelope, "[{}]")).toBe(false);
      expect(transport.getDroppedChunkCount()).toBe(1);
    });
  });

  describe("retry-queue drain", (): void => {
    const envelopeAt: (index: number) => SessionReplayChunkEnvelope = (
      index: number,
    ): SessionReplayChunkEnvelope => {
      return { ...envelope, chunkIndex: index };
    };

    /*
     * Loads the retry queue without counting breaker failures: a 429
     * enqueues the refused chunk and throttles, and every send during the
     * throttle enqueues without touching the network.
     */
    const loadQueue: (
      transport: Transport,
      count: number,
      nowRef: { nowMs: number },
    ) => Promise<void> = async (
      transport: Transport,
      count: number,
      nowRef: { nowMs: number },
    ): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(429, "", { "retry-after": "60" }));

      await transport.send(envelopeAt(0), "[{}]");

      for (let index: number = 1; index < count; index++) {
        await transport.send(envelopeAt(index), "[{}]");
      }

      expect(transport.getQueueDepth()).toBe(count);

      /* Step past the throttle window for the drain under test. */
      nowRef.nowMs += 61_000;
    };

    const withMockedNow: () => { nowMs: number } = (): { nowMs: number } => {
      const nowRef: { nowMs: number } = { nowMs: 1_700_000_000_000 };

      jest.spyOn(Date, "now").mockImplementation((): number => {
        return nowRef.nowMs;
      });

      return nowRef;
    };

    it("a retryable failure mid-drain preserves every unposted chunk behind it", async (): Promise<void> => {
      const nowRef: { nowMs: number } = withMockedNow();
      const transport: Transport = makeTransport();

      await loadQueue(transport, 3, nowRef);

      /* Drain chunk 0 fails retryably; chunks 1 and 2 must NOT vanish. */
      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValueOnce(respond(503))
        .mockResolvedValue(respond(202));
      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const sent: boolean = await transport.send(envelopeAt(3), "[{}]");

      /* Only chunk 0 (halt) and the current chunk 3 hit the network. */
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sent).toBe(true);

      /* Chunks 0, 1 and 2 are all back in the queue, none dropped. */
      expect(transport.getQueueDepth()).toBe(3);
      expect(transport.getDroppedChunkCount()).toBe(0);
      expect(transport.isDisabled()).toBe(false);
    });

    it("a rejected CHUNK mid-drain is dropped alone and the drain continues", async (): Promise<void> => {
      const nowRef: { nowMs: number } = withMockedNow();
      const transport: Transport = makeTransport();

      await loadQueue(transport, 3, nowRef);

      /* Chunk 0 is refused as oversized; 1, 2 and the current 3 are fine. */
      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValueOnce(respond(413))
        .mockResolvedValue(respond(202));
      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const sent: boolean = await transport.send(envelopeAt(3), "[{}]");

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(sent).toBe(true);
      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.getDroppedChunkCount()).toBe(1);
      /* A bad chunk is not a bad transport: the breaker is untouched. */
      expect(transport.getFlushFailureCount()).toBe(0);
    });

    it("a 429 received mid-drain throttles the CURRENT chunk too", async (): Promise<void> => {
      const nowRef: { nowMs: number } = withMockedNow();
      const transport: Transport = makeTransport();

      await loadQueue(transport, 1, nowRef);

      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValue(respond(429, "", { "retry-after": "60" }));
      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const sent: boolean = await transport.send(envelopeAt(1), "[{}]");

      /*
       * Exactly ONE request: the drained chunk that got the 429. Posting
       * the current chunk anyway would violate the throttle one request
       * after receiving it.
       */
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sent).toBe(false);
      expect(transport.isThrottled()).toBe(true);
      /* Both the drained chunk and the current one are queued for later. */
      expect(transport.getQueueDepth()).toBe(2);
      expect(transport.getDroppedChunkCount()).toBe(0);
    });

    it("a terminal disable mid-drain counts the unposted remainder as dropped", async (): Promise<void> => {
      const nowRef: { nowMs: number } = withMockedNow();
      const transport: Transport = makeTransport();

      await loadQueue(transport, 2, nowRef);

      /* Auth breaks while chunks 0 and 1 are queued: 401 disables at once. */
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(401));
      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const sent: boolean = await transport.send(envelopeAt(2), "[{}]");

      expect(sent).toBe(false);
      expect(transport.isDisabled()).toBe(true);
      expect(transport.getDisabledReason()).toBe("http-401");
      /*
       * Only chunk 0 hit the network. Chunk 1 (never posted) and the
       * current chunk 2 are ACCOUNTED for as dropped — not silently
       * vanished the way the old drain lost them.
       */
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.getDroppedChunkCount()).toBe(2);
    });
  });

  describe("parseRetryAfter", (): void => {
    it("reads a seconds value and caps it", (): void => {
      expect(
        Transport.parseRetryAfter(respond(429, "", { "retry-after": "12" })),
      ).toBe(12);
      expect(
        Transport.parseRetryAfter(respond(429, "", { "retry-after": "9999" })),
      ).toBe(300);
    });

    it("falls back to 30 seconds with no usable header", (): void => {
      expect(Transport.parseRetryAfter(respond(429))).toBe(30);
      expect(
        Transport.parseRetryAfter(respond(429, "", { "retry-after": "soon" })),
      ).toBe(30);
    });
  });

  describe("sendTerminal", (): void => {
    /*
     * fetch(keepalive), not sendBeacon: sendBeacon cannot set headers, and the
     * ingest middleware reads the auth token only from headers.
     */
    it("uses one keepalive fetch with the auth header", (): void => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      expect(makeTransport().sendTerminal(envelope, "[{}]")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;

      expect(init["keepalive"]).toBe(true);
      expect(
        (init["headers"] as Record<string, string>)["x-oneuptime-token"],
      ).toBe("secret");
    });

    /*
     * Identity, not gzip: compression is a promise chain and there is no
     * guarantee the browser keeps running microtasks for a page it is
     * discarding, so the request has to be issued synchronously.
     */
    it("declares identity encoding on the envelope it sends", (): void => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      makeTransport().sendTerminal(envelope, "[{}]");

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;
      const body: Uint8Array = init["body"] as Uint8Array;
      const text: string = new TextDecoder().decode(body);
      const parsed: Record<string, unknown> = JSON.parse(
        text.slice(0, text.indexOf("\n")),
      ) as Record<string, unknown>;

      expect(parsed["payloadEncoding"]).toBe("identity");
      expect(
        (init["headers"] as Record<string, string>)["Content-Encoding"],
      ).toBeUndefined();
    });

    /*
     * The keepalive quota is 64 KB combined per ORIGIN, so an oversized tail
     * is an acknowledged loss rather than several requests that would all fail
     * against the same limit.
     */
    it("drops rather than exceed the keepalive byte cap", (): void => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const transport: Transport = makeTransport();
      const huge: string = `[${"x".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES)}]`;

      expect(transport.sendTerminal(envelope, huge)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(transport.getDroppedChunkCount()).toBe(1);
    });
  });
});
