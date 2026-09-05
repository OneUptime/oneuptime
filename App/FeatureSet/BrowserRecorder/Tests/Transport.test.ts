import {
  MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST,
  MAX_SESSION_REPLAY_CHUNK_BYTES,
  SESSION_REPLAY_CONTENT_TYPE,
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SessionReplayChunkEnvelope,
  SessionReplayDirective,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import Chunker from "../src/Chunker";
import Transport, {
  CompressionResult,
  RETRY_BACKOFF_MS,
} from "../src/Transport";

/*
 * Node's own gzip and CompressionStream, reached through require rather than
 * an import: this package deliberately excludes @types/node (it overrides the
 * DOM's fetch and stream definitions, which is what the shipped code is
 * written against), so the two modules are typed here to exactly what this
 * file uses of them.
 */
declare const require: (id: string) => Record<string, unknown>;

interface NodeZlib {
  gunzipSync: (input: Uint8Array) => { toString: () => string };
}

const nodeZlib: NodeZlib = require("zlib") as unknown as NodeZlib;
const nodeCompressionStream: unknown = (
  require("stream/web") as Record<string, unknown>
)["CompressionStream"];

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
  let directiveReasons: Array<string | null> = [];
  let permanentFailures: Array<string> = [];

  /*
   * Every transport built in a test is disposed afterwards, because a
   * retryable failure arms a real setTimeout that would otherwise outlive
   * the test.
   */
  let transports: Array<Transport> = [];

  const makeTransport: () => Transport = (): Transport => {
    directives = [];
    directiveReasons = [];
    permanentFailures = [];

    const transport: Transport = new Transport({
      url: "https://oneuptime.com/session-replay/v1/chunk",
      headers: {
        "x-oneuptime-token": "secret",
        "x-oneuptime-app-identifier": "app-1",
      },
      onDirective: (
        directive: SessionReplayDirective,
        reason: string | null,
      ): void => {
        directives.push(directive);
        directiveReasons.push(reason);
      },
      onPermanentFailure: (reason: string): void => {
        permanentFailures.push(reason);
      },
    });

    transports.push(transport);

    return transport;
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

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  const envelopeAt: (index: number) => SessionReplayChunkEnvelope = (
    index: number,
  ): SessionReplayChunkEnvelope => {
    return { ...envelope, chunkIndex: index };
  };

  /*
   * Split a multi-frame body back into its envelopes, the way the server's
   * parser does: an envelope line, then exactly payloadBytes of payload.
   */
  const framesOf: (body: Uint8Array) => Array<SessionReplayChunkEnvelope> = (
    body: Uint8Array,
  ): Array<SessionReplayChunkEnvelope> => {
    const frames: Array<SessionReplayChunkEnvelope> = [];
    let offset: number = 0;

    while (offset < body.length) {
      const newlineIndex: number = body.indexOf(0x0a, offset);

      const parsed: SessionReplayChunkEnvelope = JSON.parse(
        new TextDecoder().decode(body.slice(offset, newlineIndex)),
      ) as SessionReplayChunkEnvelope;

      frames.push(parsed);
      offset = newlineIndex + 1 + parsed.payloadBytes;
    }

    return frames;
  };

  afterEach((): void => {
    for (const transport of transports) {
      transport.discardQueue();
    }

    transports = [];

    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("compress", (): void => {
    /*
     * The gzip branch, for real.
     *
     * This used to `return` early whenever CompressionStream was missing -
     * which in jsdom is ALWAYS - on the stated understanding that the E2E
     * fixtures covered it. They do not: every fixture frame is built with
     * payloadEncoding "identity", so the one encoding every real customer
     * chunk uses was asserted nowhere, and a framing or byte-count mistake
     * on it would have dropped every production chunk as
     * "payload-undecodable" with all the suites green.
     *
     * Node has both halves (CompressionStream since 18, zlib forever), so
     * the platform pieces jsdom lacks are installed for the duration and the
     * bytes are gunzipped back with node:zlib - the same gunzipAsync the
     * ingest worker runs.
     */
    it("gzips to bytes the ingest side can gunzip back, and says so on the envelope", async (): Promise<void> => {
      const originalCompression: unknown = globalRecord["CompressionStream"];
      const originalResponse: unknown = globalRecord["Response"];

      globalRecord["CompressionStream"] = nodeCompressionStream;

      /*
       * jsdom has no Response either. Only the one thing Transport.compress
       * asks of it is needed: drain a ReadableStream into an ArrayBuffer.
       */
      globalRecord["Response"] = class StreamResponse {
        private readonly stream: ReadableStream<Uint8Array>;

        public constructor(stream: ReadableStream<Uint8Array>) {
          this.stream = stream;
        }

        public async arrayBuffer(): Promise<ArrayBuffer> {
          const reader: ReadableStreamDefaultReader<Uint8Array> =
            this.stream.getReader();
          const parts: Array<Uint8Array> = [];
          let total: number = 0;

          for (;;) {
            const next: ReadableStreamReadResult<Uint8Array> =
              await reader.read();

            if (next.done) {
              break;
            }

            parts.push(next.value);
            total += next.value.length;
          }

          const joined: Uint8Array = new Uint8Array(total);
          let offset: number = 0;

          for (const part of parts) {
            joined.set(part, offset);
            offset += part.length;
          }

          return joined.buffer as ArrayBuffer;
        }
      };

      try {
        const payload: string = JSON.stringify([
          { type: 3, data: { source: 2, text: "a".repeat(2000) } },
        ]);

        const result: CompressionResult = await Transport.compress(payload);

        expect(result.encoding).toBe("gzip");

        /* Really compressed, and really gzip (magic 0x1f 0x8b). */
        expect(result.bytes.length).toBeLessThan(payload.length);
        expect(result.bytes[0]).toBe(0x1f);
        expect(result.bytes[1]).toBe(0x8b);

        expect(nodeZlib.gunzipSync(result.bytes).toString()).toBe(payload);

        /*
         * And through the FRAME: payloadBytes is what the parser uses to
         * find the next frame, so it has to be the compressed length, not
         * the text length.
         */
        const body: Uint8Array = Transport.buildBody(
          {
            ...envelope,
            payloadEncoding: "gzip",
            payloadBytes: result.bytes.length,
          },
          result.bytes,
        );

        const newline: number = body.indexOf(0x0a);
        const parsed: SessionReplayChunkEnvelope = JSON.parse(
          new TextDecoder().decode(body.slice(0, newline)),
        ) as SessionReplayChunkEnvelope;

        expect(parsed.payloadEncoding).toBe("gzip");
        expect(body.length - newline - 1).toBe(parsed.payloadBytes);

        expect(
          nodeZlib
            .gunzipSync(
              body.slice(newline + 1, newline + 1 + parsed.payloadBytes),
            )
            .toString(),
        ).toBe(payload);
      } finally {
        if (originalCompression === undefined) {
          delete globalRecord["CompressionStream"];
        } else {
          globalRecord["CompressionStream"] = originalCompression;
        }

        if (originalResponse === undefined) {
          delete globalRecord["Response"];
        } else {
          globalRecord["Response"] = originalResponse;
        }
      }
    });

    /*
     * The fallback is identity, never raw DEFLATE. The server's whole decode
     * vocabulary is gzip-or-none, so deflate bytes would be stored as garbage.
     */
    it("falls back to identity, never deflate", async (): Promise<void> => {
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

      globalRecord["fetch"] = fetchMock;

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
     * No Content-Encoding header, in either encoding. The body is
     * `<envelope JSON>\n<payload>` and only the payload is gzipped, so a
     * "Content-Encoding: gzip" header described a body that is not gzip. The
     * server never read it (the envelope's payloadEncoding is what the parser
     * branches on), but any proxy or CDN that honours the header would try
     * to inflate the envelope line and reject or corrupt every chunk.
     */
    it("never sends Content-Encoding, even when the payload is gzipped", async (): Promise<void> => {
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
      expect(headers["content-encoding"]).toBeUndefined();

      /* The envelope, not a header, is where the encoding is declared. */
      const sent: Array<SessionReplayChunkEnvelope> = framesOf(
        init["body"] as Uint8Array,
      );

      expect(sent).toHaveLength(1);
      expect(["gzip", "identity"]).toContain(sent[0]?.payloadEncoding);

      if (typeof globalRecord["CompressionStream"] === "function") {
        expect(sent[0]?.payloadEncoding).toBe("gzip");
      }
    });

    it("omits Content-Encoding when the payload was not compressed", async (): Promise<void> => {
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
      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(204, '{"directive":"stop"}'));

      await makeTransport().send(envelope, "[{}]");

      expect(directives).toEqual(["stop"]);
    });
  });

  describe("error handling", (): void => {
    it("permanently disables on 401 and 403", async (): Promise<void> => {
      for (const status of [401, 403]) {
        globalRecord["fetch"] = jest.fn().mockResolvedValue(respond(status));

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
      globalRecord["fetch"] = jest.fn().mockResolvedValue(respond(413));

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");
      await transport.send(envelope, "[{}]");
      await transport.send(envelope, "[{}]");

      expect(transport.isDisabled()).toBe(false);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.getDroppedChunkCount()).toBe(3);
    });

    it("throttles on 429 using Retry-After and does not count a failure", async (): Promise<void> => {
      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(429, "", { "retry-after": "60" }));

      const transport: Transport = makeTransport();

      expect(await transport.send(envelope, "[{}]")).toBe(false);
      expect(transport.isThrottled()).toBe(true);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.getQueueDepth()).toBe(1);
    });

    /*
     * The server answers 503 with directive "throttle" and retryAfterSeconds
     * when ITS storage is briefly unavailable (staging-failed,
     * policy-unavailable, rate-counter-unavailable...). It is asking for
     * patience, and the shipped recorder counted every one of those answers
     * as a strike: three storage blips inside 45 s and every live recorder
     * was dead for the rest of its page's life.
     */
    it("honours a 503 throttle with retryAfterSeconds instead of counting a strike", async (): Promise<void> => {
      jest.useFakeTimers();
      jest.setSystemTime(1_700_000_000_000);

      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(
          respond(
            503,
            '{"directive":"throttle","configEpoch":3,"retryAfterSeconds":30,"reason":"staging-failed"}',
            { "retry-after": "30" },
          ),
        );

      const transport: Transport = makeTransport();

      expect(await transport.send(envelope, "[{}]")).toBe(false);

      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.isDisabled()).toBe(false);
      expect(transport.isThrottled()).toBe(true);
      expect(transport.isThrottled(Date.now() + 30_001)).toBe(false);
      expect(transport.getQueueDepth()).toBe(1);
      expect(transport.getRetryDueAtUnixMs()).toBe(Date.now() + 30_000);

      /* The recorder is told, in the server's own words. */
      expect(directives).toEqual(["throttle"]);
      expect(directiveReasons).toEqual(["staging-failed"]);
    });

    it("treats a 503 with only a Retry-After header as a throttle too", async (): Promise<void> => {
      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(503, "", { "retry-after": "20" }));

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");

      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.isThrottled()).toBe(true);
      expect(transport.getQueueDepth()).toBe(1);
    });

    /*
     * Three CONSECUTIVE retryable failures, where consecutive means "after
     * the previous one's backoff ran out and the retry failed again" - not
     * three flush ticks that happened to land inside one short outage.
     */
    it("self-disables after three retryable failures across the backoff windows", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      globalRecord["fetch"] = jest.fn().mockResolvedValue(respond(503));

      const transport: Transport = makeTransport();

      await transport.send(envelopeAt(0), "[{}]");
      expect(transport.getFlushFailureCount()).toBe(1);
      expect(transport.isBackingOff()).toBe(true);

      /* A second chunk during the backoff waits; it is not a second strike. */
      await transport.send(envelopeAt(1), "[{}]");
      expect(transport.getFlushFailureCount()).toBe(1);
      expect(transport.getQueueDepth()).toBe(2);

      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]!);
      expect(transport.getFlushFailureCount()).toBe(2);
      expect(transport.isDisabled()).toBe(false);

      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[1]!);
      expect(transport.getFlushFailureCount()).toBe(3);
      expect(transport.isDisabled()).toBe(true);
      expect(transport.getDisabledReason()).toBe("max-flush-failures");
      expect(permanentFailures).toEqual(["max-flush-failures"]);
    });

    it("counts a network rejection as retryable", async (): Promise<void> => {
      globalRecord["fetch"] = jest.fn().mockRejectedValue(new Error("offline"));

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");

      expect(transport.getFlushFailureCount()).toBe(1);
      expect(transport.getQueueDepth()).toBe(1);
      expect(transport.isBackingOff()).toBe(true);
    });

    /*
     * The recorder fires send() from a 15 s timer without awaiting the
     * previous call. Two posts in flight during one outage used to add two
     * strikes to a three-strike breaker; serialising them means one attempt,
     * one strike, and the other chunks wait in the queue.
     */
    it("serialises concurrent sends so one outage is one strike", async (): Promise<void> => {
      delete globalRecord["CompressionStream"];

      globalRecord["fetch"] = jest.fn().mockRejectedValue(new Error("offline"));

      const transport: Transport = makeTransport();

      const results: Array<boolean> = await Promise.all([
        transport.send(envelopeAt(0), "[{}]"),
        transport.send(envelopeAt(1), "[{}]"),
        transport.send(envelopeAt(2), "[{}]"),
      ]);

      expect(results).toEqual([false, false, false]);
      expect(transport.getFlushFailureCount()).toBe(1);
      expect(transport.getQueueDepth()).toBe(3);
      expect(transport.isDisabled()).toBe(false);
    });

    /*
     * A quiet page's last chunk used to fail once and never be retried,
     * because the only drain was the NEXT send and no next chunk ever came.
     */
    it("retries a failed chunk on its own timer, without a later send", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      const fetchMock: jest.Mock = jest
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(respond(202));

      globalRecord["fetch"] = fetchMock;

      const transport: Transport = makeTransport();

      await transport.send(envelopeAt(7), "[{}]");

      expect(transport.getQueueDepth()).toBe(1);
      expect(transport.getRetryDueAtUnixMs()).toBe(
        Date.now() + RETRY_BACKOFF_MS[0]!,
      );

      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]!);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.isBackingOff()).toBe(false);
      expect(transport.getRetryDueAtUnixMs()).toBe(0);

      const retried: Array<SessionReplayChunkEnvelope> = framesOf(
        fetchMock.mock.calls[1]?.[1]?.body as Uint8Array,
      );

      expect(retried[0]?.chunkIndex).toBe(7);
      expect(retried[0]?.flushFailures).toBe(1);
    });

    it("resumes on its own once a throttle window ends", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValueOnce(respond(429, "", { "retry-after": "10" }))
        .mockResolvedValue(respond(202));

      globalRecord["fetch"] = fetchMock;

      const transport: Transport = makeTransport();

      await transport.send(envelopeAt(0), "[{}]");
      expect(transport.getQueueDepth()).toBe(1);

      await jest.advanceTimersByTimeAsync(10_000);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.isThrottled()).toBe(false);
    });

    /*
     * The retry queue holds up to MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST fully
     * serialised chunks of end-user page content. disable() clears it, but
     * revokeConsent() and stop() do not go through disable(), so the "revoke
     * drops the buffer" contract used to hold for the ring buffer and not for
     * the part already handed to the transport.
     */
    it("drops queued chunks on discardQueue and cancels the retry", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      globalRecord["fetch"] = jest.fn().mockRejectedValue(new Error("offline"));

      const transport: Transport = makeTransport();

      await transport.send(envelope, '[{"secret":"page content"}]');

      expect(transport.getQueueDepth()).toBe(1);
      expect(transport.getRetryDueAtUnixMs()).toBeGreaterThan(0);

      transport.discardQueue();

      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.getRetryDueAtUnixMs()).toBe(0);

      /* And nothing resurrects it: the timer is gone... */
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));
      globalRecord["fetch"] = fetchMock;

      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]! * 2);

      expect(fetchMock).not.toHaveBeenCalled();

      /* ...and the next send posts only its own chunk. */
      await transport.send(envelope, "[{}]");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        new TextDecoder().decode(
          fetchMock.mock.calls[0]?.[1]?.body as Uint8Array,
        ),
      ).not.toContain("page content");
    });

    it("resets the failure count after a success", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValueOnce(respond(503))
        .mockResolvedValue(respond(202));

      globalRecord["fetch"] = fetchMock;

      const transport: Transport = makeTransport();

      await transport.send(envelopeAt(0), "[{}]");
      expect(transport.getFlushFailureCount()).toBe(1);

      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]!);
      expect(transport.getFlushFailureCount()).toBe(0);

      expect(await transport.send(envelopeAt(1), "[{}]")).toBe(true);
      expect(transport.getFlushFailureCount()).toBe(0);
    });

    it("stops accepting chunks once disabled", async (): Promise<void> => {
      globalRecord["fetch"] = jest.fn().mockResolvedValue(respond(401));

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");

      expect(await transport.send(envelope, "[{}]")).toBe(false);
      expect(transport.getDroppedChunkCount()).toBe(1);
    });
  });

  /*
   * A 400 is the server saying "I understood you and the answer is no". When
   * the answer is about the RECORDER - its wire version, the application it
   * claims to be - every later chunk gets the same answer, and a recorder
   * that records, compresses and posts every 15 s to be refused each time is
   * battery and bandwidth spent on a customer's site for nothing.
   */
  describe("deterministic refusals", (): void => {
    const assertStopsFor: (error: string) => Promise<void> = async (
      error: string,
    ): Promise<void> => {
      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValue(
          respond(400, JSON.stringify({ error: error, message: "no" })),
        );

      globalRecord["fetch"] = fetchMock;

      const transport: Transport = makeTransport();

      expect(await transport.send(envelope, "[{}]")).toBe(false);
      expect(transport.isDisabled()).toBe(true);
      expect(transport.getDisabledReason()).toBe(`http-400:${error}`);
      expect(permanentFailures).toEqual([`http-400:${error}`]);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.getQueueDepth()).toBe(0);

      /* Not retried, and later chunks never leave the page. */
      await transport.send(envelope, "[{}]");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    };

    it.each([
      "unsupported-wire-version",
      "app-identifier-mismatch",
      "missing-app-identifier",
      "malformed-body",
    ])(
      "stops for good on a 400 naming %s",
      async (error: string): Promise<void> => {
        await assertStopsFor(error);
      },
    );

    it("acts on a stop directive carried by a 4xx body", async (): Promise<void> => {
      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(
          respond(400, '{"directive":"stop","reason":"not-enabled"}'),
        );

      const transport: Transport = makeTransport();

      await transport.send(envelope, "[{}]");

      expect(directives).toEqual(["stop"]);
      expect(directiveReasons).toEqual(["not-enabled"]);
      expect(transport.getFlushFailureCount()).toBe(0);
    });

    /*
     * A 400 that names nothing the recorder can act on is forgiven once - a
     * single odd frame - but an unbroken run of them is a misconfiguration
     * the server will keep answering, so the recorder stops rather than
     * posting into it for the rest of the page's life.
     */
    it("stops after three consecutive unexplained 400s", async (): Promise<void> => {
      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(400, '{"error":"truncated-payload"}'));

      const transport: Transport = makeTransport();

      await transport.send(envelopeAt(0), "[{}]");
      await transport.send(envelopeAt(1), "[{}]");

      expect(transport.isDisabled()).toBe(false);
      expect(transport.getDroppedChunkCount()).toBe(2);

      await transport.send(envelopeAt(2), "[{}]");

      expect(transport.isDisabled()).toBe(true);
      expect(transport.getDisabledReason()).toBe("http-400-repeated");
      /* Still not a transport failure: the breaker's own count is untouched. */
      expect(transport.getFlushFailureCount()).toBe(0);
    });

    it("an accepted chunk resets the run of 400s", async (): Promise<void> => {
      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValueOnce(respond(400))
        .mockResolvedValueOnce(respond(400))
        .mockResolvedValueOnce(respond(202))
        .mockResolvedValueOnce(respond(400))
        .mockResolvedValueOnce(respond(400));

      const transport: Transport = makeTransport();

      for (let index: number = 0; index < 5; index++) {
        await transport.send(envelopeAt(index), "[{}]");
      }

      expect(transport.isDisabled()).toBe(false);
      expect(transport.getDroppedChunkCount()).toBe(4);
    });

    it("a 413 or 422 never counts toward the run of 400s", async (): Promise<void> => {
      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValueOnce(respond(400))
        .mockResolvedValueOnce(respond(413))
        .mockResolvedValueOnce(respond(422))
        .mockResolvedValueOnce(respond(400))
        .mockResolvedValueOnce(respond(413));

      const transport: Transport = makeTransport();

      for (let index: number = 0; index < 5; index++) {
        await transport.send(envelopeAt(index), "[{}]");
      }

      expect(transport.isDisabled()).toBe(false);
      expect(transport.getDroppedChunkCount()).toBe(5);
    });
  });

  describe("retry-queue drain", (): void => {
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
      globalRecord["fetch"] = jest
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

    it("a retryable failure mid-drain preserves every unposted chunk, and the current one", async (): Promise<void> => {
      const nowRef: { nowMs: number } = withMockedNow();
      const transport: Transport = makeTransport();

      await loadQueue(transport, 3, nowRef);

      /* Drain chunk 0 fails retryably; chunks 1 and 2 must NOT vanish. */
      const fetchMock: jest.Mock = jest
        .fn()
        .mockResolvedValueOnce(respond(503))
        .mockResolvedValue(respond(202));
      globalRecord["fetch"] = fetchMock;

      const sent: boolean = await transport.send(envelopeAt(3), "[{}]");

      /*
       * Exactly ONE request: the drained chunk that failed. The current
       * chunk is not posted straight into the same outage - that would be a
       * second attempt, and a second strike, for one failure.
       */
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sent).toBe(false);

      /* Chunks 0, 1, 2 and 3 are all in the queue in order, none dropped. */
      expect(transport.getQueueDepth()).toBe(4);
      expect(transport.getDroppedChunkCount()).toBe(0);
      expect(transport.isDisabled()).toBe(false);
      expect(transport.getFlushFailureCount()).toBe(1);

      /* Once the backoff passes, a later send drains them all, in order. */
      nowRef.nowMs += RETRY_BACKOFF_MS[0]! + 1;

      await transport.send(envelopeAt(4), "[{}]");

      expect(fetchMock).toHaveBeenCalledTimes(6);

      const indexes: Array<number> = fetchMock.mock.calls
        .slice(1)
        .map((call: Array<unknown>): number => {
          const init: Record<string, unknown> = call[1] as Record<
            string,
            unknown
          >;

          return framesOf(init["body"] as Uint8Array)[0]?.chunkIndex ?? -1;
        });

      expect(indexes).toEqual([0, 1, 2, 3, 4]);
      expect(transport.getQueueDepth()).toBe(0);
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
      globalRecord["fetch"] = fetchMock;

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
      globalRecord["fetch"] = fetchMock;

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
      globalRecord["fetch"] = fetchMock;

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

    it("gives up on one chunk that keeps failing without giving up on the rest", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      /*
       * Chunk 0 fails twice, then the network heals for everything - the
       * drain after the second backoff retries chunk 0 a third time and
       * succeeds. The point: attempts are per chunk, strikes are per outage,
       * and a chunk that comes good is never dropped early.
       */
      const fetchMock: jest.Mock = jest
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(respond(202));

      globalRecord["fetch"] = fetchMock;

      const transport: Transport = makeTransport();

      await transport.send(envelopeAt(0), "[{}]");
      await transport.send(envelopeAt(1), "[{}]");

      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]!);
      expect(transport.getFlushFailureCount()).toBe(2);
      expect(transport.getQueueDepth()).toBe(2);

      await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[1]!);

      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.getFlushFailureCount()).toBe(0);
      expect(transport.getDroppedChunkCount()).toBe(0);
      expect(transport.isDisabled()).toBe(false);
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

  /*
   * WP-S1 (ingest-8). A chunk that is still over the per-request cap after
   * gzip is an indivisible full snapshot of a very large DOM. Posting the
   * real bytes earns a 413 from nginx or the middleware's byte counter and
   * no disclosure anywhere; declaring the SIZE with an empty body reaches
   * the parser's payloadBytes check, which answers 422 - "the session
   * survives this, with a fidelity notice" - and costs the visitor's uplink
   * nothing.
   */
  describe("an oversized chunk", (): void => {
    it("declares the size, sends no payload, and tells the recorder to disclose it", async (): Promise<void> => {
      delete globalRecord["CompressionStream"];

      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(422));

      globalRecord["fetch"] = fetchMock;

      const tooLarge: Array<number> = [];
      const transport: Transport = new Transport({
        url: "https://oneuptime.com/telemetry/session-replay/v1/chunk",
        headers: { "x-oneuptime-token": "secret" },
        onDirective: (): void => {
          /* Not under test. */
        },
        onPermanentFailure: (): void => {
          /* Not under test. */
        },
        onChunkTooLarge: (bytes: number): void => {
          tooLarge.push(bytes);
        },
      });

      transports.push(transport);

      const payload: string = `[${"x".repeat(MAX_SESSION_REPLAY_CHUNK_BYTES)}]`;

      await transport.send({ ...envelope, hasFullSnapshot: true }, payload);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;
      const body: Uint8Array = init["body"] as Uint8Array;
      const newline: number = body.indexOf(0x0a);
      const parsed: SessionReplayChunkEnvelope = JSON.parse(
        new TextDecoder().decode(body.slice(0, newline)),
      ) as SessionReplayChunkEnvelope;

      /* The declared size is the real one; the body carries none of it. */
      expect(parsed.payloadBytes).toBeGreaterThan(
        MAX_SESSION_REPLAY_CHUNK_BYTES,
      );
      expect(body.length - newline - 1).toBe(0);

      expect(tooLarge).toEqual([parsed.payloadBytes]);

      /* A refused chunk, not a refused transport: the recorder carries on. */
      expect(transport.isDisabled()).toBe(false);
      expect(transport.getDroppedChunkCount()).toBe(1);
      expect(transport.getQueueDepth()).toBe(0);
    });
  });

  describe("sendTerminal", (): void => {
    /*
     * fetch(keepalive), not sendBeacon: sendBeacon cannot set headers, and the
     * ingest middleware reads the auth token only from headers.
     */
    it("uses one keepalive fetch with the auth header", (): void => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));

      globalRecord["fetch"] = fetchMock;

      expect(
        makeTransport().sendTerminal([{ envelope: envelope, payload: "[{}]" }]),
      ).toBe(true);
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

      globalRecord["fetch"] = fetchMock;

      makeTransport().sendTerminal([{ envelope: envelope, payload: "[{}]" }]);

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

      globalRecord["fetch"] = fetchMock;

      const transport: Transport = makeTransport();
      const huge: string = `[${"x".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES)}]`;

      expect(
        transport.sendTerminal([{ envelope: envelope, payload: huge }]),
      ).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(transport.getDroppedChunkCount()).toBe(1);
    });

    /*
     * Chunks waiting for a retry when the page goes away used to go away
     * with it: sendTerminal never looked at the queue, and stop() discarded
     * it. The page's last request can carry several frames, so they ride
     * along - as many as fit under the quota, oldest first.
     */
    it("carries the retry queue out as extra frames of the final request", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(429, "", { "retry-after": "60" }));

      const transport: Transport = makeTransport();

      await transport.send(envelopeAt(4), '[{"i":4}]');
      await transport.send(envelopeAt(5), '[{"i":5}]');

      expect(transport.getQueueDepth()).toBe(2);

      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));
      globalRecord["fetch"] = fetchMock;

      expect(
        transport.sendTerminal([
          { envelope: { ...envelopeAt(6), isFinal: true }, payload: "[{}]" },
        ]),
      ).toBe(true);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;

      expect(init["keepalive"]).toBe(true);

      const frames: Array<SessionReplayChunkEnvelope> = framesOf(
        init["body"] as Uint8Array,
      );

      expect(
        frames.map((frame: SessionReplayChunkEnvelope): number => {
          return frame.chunkIndex;
        }),
      ).toEqual([4, 5, 6]);
      expect(frames[2]?.isFinal).toBe(true);
      expect(
        frames.every((frame: SessionReplayChunkEnvelope): boolean => {
          return frame.payloadEncoding === "identity";
        }),
      ).toBe(true);

      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.getDroppedChunkCount()).toBe(0);
      expect(transport.getRetryDueAtUnixMs()).toBe(0);
    });

    it("drops and counts queued chunks that do not fit under the quota, keeping the final one", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(429, "", { "retry-after": "60" }));

      const transport: Transport = makeTransport();
      const big: string = `[${"x".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES - 200)}]`;

      await transport.send(envelopeAt(1), big);
      await transport.send(envelopeAt(2), '[{"i":2}]');

      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));
      globalRecord["fetch"] = fetchMock;

      expect(
        transport.sendTerminal([{ envelope: envelopeAt(3), payload: "[{}]" }]),
      ).toBe(true);

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;
      const body: Uint8Array = init["body"] as Uint8Array;

      expect(body.length).toBeLessThanOrEqual(
        SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
      );
      expect(
        framesOf(body).map((frame: SessionReplayChunkEnvelope): number => {
          return frame.chunkIndex;
        }),
      ).toEqual([2, 3]);
      expect(transport.getDroppedChunkCount()).toBe(1);
    });

    it("never packs more frames than one request may carry", async (): Promise<void> => {
      jest.useFakeTimers();
      delete globalRecord["CompressionStream"];

      globalRecord["fetch"] = jest
        .fn()
        .mockResolvedValue(respond(429, "", { "retry-after": "60" }));

      const transport: Transport = makeTransport();

      for (
        let index: number = 0;
        index < MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST;
        index++
      ) {
        await transport.send(envelopeAt(index), "[]");
      }

      const fetchMock: jest.Mock = jest.fn().mockResolvedValue(respond(202));
      globalRecord["fetch"] = fetchMock;

      transport.sendTerminal([{ envelope: envelopeAt(99), payload: "[]" }]);

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;

      expect(framesOf(init["body"] as Uint8Array).length).toBe(
        MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST,
      );
      expect(transport.getDroppedChunkCount()).toBe(1);
    });
  });
});
