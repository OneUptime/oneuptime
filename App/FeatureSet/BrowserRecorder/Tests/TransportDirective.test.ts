import {
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SESSION_REPLAY_MAX_FLUSH_FAILURES,
  SessionReplayChunkEnvelope,
  SessionReplayDirective,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import Chunker from "../src/Chunker";
import { DebugRecord, clearDebugRecords, getDebugRecords } from "../src/Debug";
import Transport from "../src/Transport";

/*
 * What the server tells a live recorder to do, and what the recorder says
 * about it afterwards.
 *
 * Two failures are the reason this file exists, and both of them looked like
 * "session replay just stopped working" from the outside:
 *
 * 1. THE BODYLESS 204. The status the server sends when it stands a recorder
 *    down - over budget, unsampled, rate limited - is 204, which has no body.
 *    The instruction rides on x-oneuptime-replay-directive and the reason on
 *    x-oneuptime-replay-reason, and CorsOptions exposes both cross-origin for
 *    exactly this reader. applyDirective() only ever parsed the body and
 *    returned early when it was empty, so every one of those responses was
 *    read as a plain success: the kill switch's fast path did nothing at all
 *    and the recorder kept posting chunks the server had already refused.
 *
 * 2. THE DROPPED REASON. SessionReplayChunkResponse has carried `reason`
 *    from the start, documented as existing so that a recorder told to stop
 *    without a reason does not leave the customer diagnosing silence - and
 *    nothing read it. It is now handed to onDirective and logged.
 *
 * Because the reason arrives over the wire it is treated as untrusted input
 * on the way to a log line, and that boundary is asserted here too.
 *
 * Assertions read getDebugRecords() rather than the console: records are kept
 * whether or not logging is switched on, and the switch is off in these tests
 * exactly as it is on a customer's page.
 */

const STATE_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_DEBUG__";

/*
 * Distinctive on purpose. Every record produced anywhere in this file is
 * searched for it, because the transport is the one module that holds the
 * ingest credential and also writes diagnostics a customer is asked to paste
 * into a support ticket.
 */
const INGEST_TOKEN: string = "ingest-token-2f7c9a";

interface ReceivedDirective {
  directive: SessionReplayDirective;
  reason: string | null;
}

function globalRecord(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}

/*
 * The debug timeline lives on a global so the loader stub and the artifact
 * share one timeline, which also means it outlives a test case. Every case
 * starts from nothing.
 */
function resetDebugState(): void {
  delete globalRecord()[STATE_GLOBAL];
}

function codes(): Array<string> {
  return getDebugRecords().map((record: DebugRecord): string => {
    return record.code;
  });
}

function recordFor(code: string): DebugRecord | undefined {
  return getDebugRecords().find((record: DebugRecord): boolean => {
    return record.code === code;
  });
}

function detailOf(code: string): Record<string, unknown> {
  return (recordFor(code)?.detail || {}) as Record<string, unknown>;
}

/* Everything a support ticket would carry, as one searchable string. */
function serializedRecords(): string {
  return JSON.stringify(getDebugRecords());
}

describe("Transport directives and diagnostics", (): void => {
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

  let directives: Array<ReceivedDirective> = [];
  let permanentFailures: Array<string> = [];

  /*
   * A retryable failure arms a real retry timer; every transport built here
   * is discarded afterwards so no timer outlives its test.
   */
  let transports: Array<Transport> = [];

  const makeTransport: () => Transport = (): Transport => {
    directives = [];
    permanentFailures = [];

    const transport: Transport = new Transport({
      url: "https://oneuptime.com/session-replay/v1/chunk",
      headers: {
        "x-oneuptime-token": INGEST_TOKEN,
        "x-oneuptime-app-identifier": "app-1",
      },
      onDirective: (
        directive: SessionReplayDirective,
        reason: string | null,
      ): void => {
        directives.push({ directive: directive, reason: reason });
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

  const setFetch: (response: Response) => jest.Mock = (
    response: Response,
  ): jest.Mock => {
    const fetchMock: jest.Mock = jest.fn().mockResolvedValue(response);

    globalRecord()["fetch"] = fetchMock;

    return fetchMock;
  };

  beforeEach((): void => {
    resetDebugState();
  });

  afterEach((): void => {
    for (const transport of transports) {
      transport.discardQueue();
    }

    transports = [];

    jest.restoreAllMocks();
    resetDebugState();
  });

  describe("the bodyless 204", (): void => {
    /*
     * The regression itself. A 204 has no body, so the old body-only parser
     * returned early and the recorder read "stop, you are over budget" as a
     * successful upload - then posted the next chunk, and the one after that.
     */
    it("reads the directive and the reason off the headers when there is no body", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(
        respond(204, "", {
          "x-oneuptime-replay-directive": "stop",
          "x-oneuptime-replay-reason": "budget-exhausted",
        }),
      );

      await transport.send(envelope, "[{}]");

      expect(directives).toEqual([
        { directive: "stop", reason: "budget-exhausted" },
      ]);

      /* `via` is what distinguishes the header fallback from the body path. */
      expect(detailOf("server-directive")["via"]).toBe("header");
      expect(detailOf("server-directive")["reason"]).toBe("budget-exhausted");
    });

    /*
     * A server that predates the headers sends a bare 204. Inventing a
     * directive there would stop recorders against every deployment that has
     * not caught up yet, so the transport still treats it as a success at the
     * protocol level.
     *
     * The DIAGNOSTIC is not "accepted", though. 204 is exactly the status the
     * server sends when it deliberately did not record - over budget, not
     * sampled, application disabled - and its own metrics middleware refuses
     * the same conflation in as many words. The docs teach a customer to look
     * for chunk-accepted as proof their install works, so calling a
     * stand-down an acceptance would confirm an installation that is storing
     * nothing.
     */
    it("reports a bare 204 as not recorded rather than accepted", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(respond(204));

      expect(await transport.send(envelope, "[{}]")).toBe(true);

      expect(directives).toEqual([]);
      expect(codes()).not.toContain("server-directive");
      expect(codes()).not.toContain("chunk-accepted");
      expect(codes()).toContain("chunk-not-recorded");
      expect(detailOf("chunk-not-recorded")["status"]).toBe(204);
    });

    /* And a 202 - a chunk that was actually stored - still reads as accepted. */
    it("reports a 202 as accepted", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(respond(202));

      expect(await transport.send(envelope, "[{}]")).toBe(true);

      expect(codes()).toContain("chunk-accepted");
      expect(codes()).not.toContain("chunk-not-recorded");
    });

    /*
     * Not every fetch implementation on a customer's page is the platform's.
     * A response object with no `headers` at all must be as uneventful as one
     * whose headers are simply empty, and must not throw into their page.
     */
    it("survives a response object that has no headers at all", async (): Promise<void> => {
      const headerless: Response = {
        status: 204,
        text: async (): Promise<string> => {
          return "";
        },
      } as unknown as Response;

      const transport: Transport = makeTransport();

      setFetch(headerless);

      expect(await transport.send(envelope, "[{}]")).toBe(true);
      expect(directives).toEqual([]);
    });
  });

  describe("the reason on a directive", (): void => {
    /*
     * The second fix. Without the reason, "your recorder was told to stop" is
     * an answer nobody can act on; with it, the support reply is one line.
     */
    it("passes the reason through from a JSON body", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(
        respond(200, '{"directive":"throttle","reason":"rate-limited"}'),
      );

      await transport.send(envelope, "[{}]");

      expect(directives).toEqual([
        { directive: "throttle", reason: "rate-limited" },
      ]);
      expect(detailOf("server-directive")["reason"]).toBe("rate-limited");
    });

    /*
     * A directive with no reason is still a directive. It arrives as null so
     * the recorder can say "not-reported" rather than print `undefined`.
     */
    it("reports null when the body names a directive without a reason", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(respond(200, '{"directive":"stop"}'));

      await transport.send(envelope, "[{}]");

      expect(directives).toEqual([{ directive: "stop", reason: null }]);
      expect(detailOf("server-directive")["reason"]).toBe("not-reported");
    });

    /*
     * Headers are the fallback for the bodyless case only. A response that
     * has both is a server that answered in full, and the body is the
     * authoritative half - reading both would fire onDirective twice and
     * could stop a recorder the body only asked to slow down.
     */
    it("prefers the body over the headers when a response carries both", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(
        respond(200, '{"directive":"throttle","reason":"rate-limited"}', {
          "x-oneuptime-replay-directive": "stop",
          "x-oneuptime-replay-reason": "budget-exhausted",
        }),
      );

      await transport.send(envelope, "[{}]");

      expect(directives).toEqual([
        { directive: "throttle", reason: "rate-limited" },
      ]);
      expect(detailOf("server-directive")["via"]).toBeUndefined();
    });

    /*
     * The directive vocabulary is closed. Anything else is a proxy, a
     * captive portal or a future server, and acting on it would let an
     * intermediary switch off a customer's recording.
     */
    it("ignores a directive value it does not recognise, in the body or a header", async (): Promise<void> => {
      const fromBody: Transport = makeTransport();

      setFetch(respond(200, '{"directive":"self-destruct","reason":"nope"}'));

      await fromBody.send(envelope, "[{}]");

      expect(directives).toEqual([]);
      expect(codes()).not.toContain("server-directive");

      clearDebugRecords();

      const fromHeader: Transport = makeTransport();

      setFetch(
        respond(204, "", {
          "x-oneuptime-replay-directive": "self-destruct",
          "x-oneuptime-replay-reason": "nope",
        }),
      );

      await fromHeader.send(envelope, "[{}]");

      expect(directives).toEqual([]);
      expect(codes()).not.toContain("server-directive");
      expect(fromHeader.isDisabled()).toBe(false);
    });

    /*
     * The reason is a closed server-side vocabulary, but it still arrives
     * over the network, so it is bounded before it is ever written to a
     * record a customer will paste somewhere. A server, or anything sitting
     * in front of it, must not be able to push 300 characters of its choosing
     * into the diagnostics timeline.
     *
     * REJECTED rather than truncated, and the difference matters twice over.
     * Slicing first and testing the slice let a long string made entirely of
     * vocabulary characters through as its first 64 - which is not a member
     * of the vocabulary, so nothing downstream can branch on it, and it is
     * still 64 characters somebody else chose landing in a console line. The
     * directive itself is unaffected: an unusable reason degrades to
     * "not-reported", it never suppresses the instruction.
     */
    it("drops an over-long reason without dropping the directive", async (): Promise<void> => {
      const longReason: string = "over-budget-".repeat(25);

      expect(longReason.length).toBe(300);

      const transport: Transport = makeTransport();

      setFetch(
        respond(200, JSON.stringify({ directive: "stop", reason: longReason })),
      );

      await transport.send(envelope, "[{}]");

      const received: ReceivedDirective | undefined = directives[0];

      expect(received?.directive).toBe("stop");
      expect(received?.reason).toBeNull();

      /* Neither the whole string nor any prefix of it reaches a log line. */
      expect(serializedRecords()).not.toContain("over-budget-over-budget-");
      expect(detailOf("server-directive")["reason"]).toBe("not-reported");
    });

    /* A reason exactly at the bound is still usable. */
    it("keeps a reason at the length limit", async (): Promise<void> => {
      const atLimit: string = "b".repeat(64);

      const transport: Transport = makeTransport();

      setFetch(
        respond(200, JSON.stringify({ directive: "stop", reason: atLimit })),
      );

      await transport.send(envelope, "[{}]");

      expect(directives[0]?.reason).toBe(atLimit);
    });

    /*
     * Anything outside [A-Za-z0-9_.:-] is refused outright rather than
     * escaped, because the destination is a console line and a support
     * ticket. A newline in a reason forges a second log line, and markup in
     * one lands wherever those records are later rendered - both from a
     * string the recorder never asked a human to trust.
     */
    it("drops a reason that is not in the closed vocabulary", async (): Promise<void> => {
      const hostile: Array<{ reason: string; marker: string }> = [
        { reason: "budget-exhausted\nforged-second-line", marker: "forged" },
        { reason: "budget-exhausted\n", marker: "exhausted" },
        { reason: "<script>alert(1)</script>", marker: "alert(1)" },
        { reason: "over budget", marker: "over budget" },
      ];

      for (const candidate of hostile) {
        clearDebugRecords();

        const transport: Transport = makeTransport();

        setFetch(
          respond(
            200,
            JSON.stringify({ directive: "stop", reason: candidate.reason }),
          ),
        );

        await transport.send(envelope, "[{}]");

        /* The directive still stands; only its unusable reason is dropped. */
        expect(directives).toEqual([{ directive: "stop", reason: null }]);
        expect(detailOf("server-directive")["reason"]).toBe("not-reported");
        expect(serializedRecords()).not.toContain(candidate.marker);
      }
    });

    /* The header path is the same reader, and it is the untrusted one. */
    it("drops an unusable reason that arrives on the 204 headers", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(
        respond(204, "", {
          "x-oneuptime-replay-directive": "stop",
          "x-oneuptime-replay-reason": "<script>alert(1)</script>",
        }),
      );

      await transport.send(envelope, "[{}]");

      expect(directives).toEqual([{ directive: "stop", reason: null }]);
      expect(serializedRecords()).not.toContain("alert(1)");
    });

    /*
     * Reading the directive out of a 2xx body must not cost the rest of that
     * body: retryAfterSeconds is how a healthy server slows a recorder down
     * without spending a 429 on it.
     */
    it("still honours retryAfterSeconds in a 2xx body", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(respond(200, '{"directive":"continue","retryAfterSeconds":60}'));

      await transport.send(envelope, "[{}]");

      expect(directives).toEqual([{ directive: "continue", reason: null }]);
      expect(transport.isThrottled()).toBe(true);
    });
  });

  describe("diagnostics records", (): void => {
    /*
     * The one record that says uploading works. Its fields are what a
     * support engineer reads first: which chunk, how big, and whether the
     * final one made it - a bare "accepted" answers none of those.
     *
     * payloadBytes is the count from the envelope that ACTUALLY WENT on the
     * wire, not the caller's. post() overwrites the envelope with the
     * post-compression length before sending, so reporting the caller's
     * would show a different number here from the one the server received
     * for the same chunk - which is the kind of discrepancy that turns a
     * five-minute support answer into an afternoon.
     */
    it("records chunk-accepted with the bytes that were actually sent", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(respond(202));

      /*
       * A caller-supplied payloadBytes that could not possibly be right, so
       * a regression to reading chunk.envelope fails loudly rather than
       * coincidentally matching.
       */
      await transport.send(
        { ...envelope, chunkIndex: 7, payloadBytes: 999999, isFinal: true },
        "[{}]",
      );

      const detail: Record<string, unknown> = detailOf("chunk-accepted");

      expect(detail["status"]).toBe(202);
      expect(detail["chunkIndex"]).toBe(7);
      expect(detail["isFinal"]).toBe(true);
      expect(detail["payloadBytes"]).not.toBe(999999);
      expect(typeof detail["payloadBytes"]).toBe("number");
      expect(detail["payloadBytes"] as number).toBeGreaterThan(0);

      /* And the encoding, so a gzip that silently fell back is visible. */
      expect(["gzip", "identity"]).toContain(detail["payloadEncoding"]);
    });

    /*
     * The three statuses that stop the recorder for good, each with a fix in
     * a different place: a bad token, an origin the project does not allow,
     * an ingest URL that does not exist. Before these records a recorder
     * simply went quiet mid-session with nothing printed anywhere.
     */
    it("records the status and the disable reason on 401, 403 and 404", async (): Promise<void> => {
      for (const status of [401, 403, 404]) {
        clearDebugRecords();

        const transport: Transport = makeTransport();

        setFetch(respond(status));

        await transport.send(envelope, "[{}]");

        expect(detailOf("chunk-rejected-terminal")["status"]).toBe(status);
        expect(detailOf("transport-disabled")["reason"]).toBe(`http-${status}`);
        expect(transport.isDisabled()).toBe(true);
        expect(permanentFailures).toEqual([`http-${status}`]);
      }
    });

    /*
     * A refused chunk is the chunk's problem, not the transport's. The
     * record has to make that visible, because "one oversized chunk" and
     * "uploading has stopped" are the same missing seconds in the player and
     * completely different things to go and fix.
     */
    it("records chunk-refused on 413, 422 and 400 without disabling anything", async (): Promise<void> => {
      for (const status of [413, 422, 400]) {
        clearDebugRecords();

        const transport: Transport = makeTransport();

        setFetch(respond(status));

        await transport.send({ ...envelope, chunkIndex: 3 }, "[{}]");

        expect(detailOf("chunk-refused")).toMatchObject({
          status: status,
          chunkIndex: 3,
        });
        expect(codes()).not.toContain("transport-disabled");
        expect(transport.isDisabled()).toBe(false);
        expect(permanentFailures).toEqual([]);
      }
    });

    /*
     * A throttled recorder looks exactly like a broken one from the network
     * tab. The wait it is serving is the whole answer.
     */
    it("records chunk-throttled with the seconds it will wait", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(respond(429, "", { "retry-after": "45" }));

      await transport.send(envelope, "[{}]");

      expect(detailOf("chunk-throttled")["retryAfterSeconds"]).toBe(45);
      expect(transport.isThrottled()).toBe(true);
    });

    /*
     * The request never left, so there is nothing in the network tab to look
     * at - which is why the URL that was attempted is in the record. It is
     * the ingest endpoint, and an ad blocker or a CSP eating it is the most
     * common cause of a recorder that uploads nothing.
     */
    it("records chunk-post-failed with the URL when fetch rejects", async (): Promise<void> => {
      globalRecord()["fetch"] = jest
        .fn()
        .mockRejectedValue(new Error("offline"));

      const transport: Transport = makeTransport();

      await transport.send({ ...envelope, chunkIndex: 2 }, "[{}]");

      expect(detailOf("chunk-post-failed")).toMatchObject({
        url: "https://oneuptime.com/session-replay/v1/chunk",
        chunkIndex: 2,
        consecutiveFailures: 1,
      });
    });

    /*
     * A 5xx is retried, so the record carries how close the circuit breaker
     * is to giving up - the difference between a blip and a recorder that is
     * about to disable itself for the rest of the page's life.
     */
    it("records chunk-post-server-error with the failure count on a 500", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(respond(500));

      await transport.send(envelope, "[{}]");

      expect(detailOf("chunk-post-server-error")).toMatchObject({
        status: 500,
        consecutiveFailures: 1,
        maxFlushFailures: SESSION_REPLAY_MAX_FLUSH_FAILURES,
      });
      expect(transport.isDisabled()).toBe(false);
    });

    /*
     * The last seconds before the tab closed are the ones an investigation
     * usually needs, and they are the ones the keepalive quota can silently
     * eat. An acknowledged loss with the two byte counts in it beats a replay
     * that just ends early for no stated reason.
     */
    it("records final-chunk-too-large when the tail exceeds the keepalive quota", (): void => {
      setFetch(respond(202));

      const transport: Transport = makeTransport();
      const huge: string = `[${"x".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES)}]`;

      expect(
        transport.sendTerminal([{ envelope: envelope, payload: huge }]),
      ).toBe(false);

      const detail: Record<string, unknown> = detailOf("final-chunk-too-large");

      expect(detail["maxBytes"]).toBe(SESSION_REPLAY_KEEPALIVE_MAX_BYTES);
      expect(detail["bytes"] as number).toBeGreaterThan(
        SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
      );
    });

    /*
     * "continue" arrives on every accepted chunk of a healthy session. Warning
     * about it would bury the two directives that actually change what the
     * recorder does under a line every few seconds.
     */
    it("warns on stop and throttle but stays quiet on continue", async (): Promise<void> => {
      const carryOn: Transport = makeTransport();

      setFetch(respond(200, '{"directive":"continue"}'));

      await carryOn.send(envelope, "[{}]");

      expect(directives).toEqual([{ directive: "continue", reason: null }]);
      expect(codes()).not.toContain("server-directive");

      for (const directive of ["stop", "throttle"]) {
        clearDebugRecords();

        const transport: Transport = makeTransport();

        setFetch(respond(200, JSON.stringify({ directive: directive })));

        await transport.send(envelope, "[{}]");

        expect(recordFor("server-directive")?.level).toBe("warn");
        expect(detailOf("server-directive")["directive"]).toBe(directive);
      }
    });

    /*
     * The server's 503 is a throttle in its own vocabulary: directive
     * "throttle", retryAfterSeconds, and a reason such as staging-failed.
     * The record says so, and the recorder is told the reason, because a
     * recorder pausing on the server's instruction and a recorder that has
     * lost its network look identical from the page.
     */
    it("records a 503 throttle with its reason and never a strike", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(
        respond(
          503,
          '{"directive":"throttle","configEpoch":2,"retryAfterSeconds":30,"reason":"staging-failed"}',
          { "retry-after": "30" },
        ),
      );

      await transport.send(envelope, "[{}]");

      expect(detailOf("chunk-throttled")).toMatchObject({
        status: 503,
        retryAfterSeconds: 30,
        reason: "staging-failed",
      });
      expect(codes()).not.toContain("chunk-post-server-error");
      expect(codes()).not.toContain("transport-disabled");
      expect(directives).toEqual([
        { directive: "throttle", reason: "staging-failed" },
      ]);
      expect(transport.getFlushFailureCount()).toBe(0);
    });

    /*
     * REGRESSION (recorder-6). A 429 or 503 whose body carries directive
     * "stop" is still a stop. The throttle path notified the recorder
     * (which shuts down and discards its queue) and THEN re-queued the chunk
     * and scheduled a drain, so one more request of page content went out
     * after the operator's kill switch had explicitly asked for none.
     */
    it("does not re-queue or retry a chunk when a throttle response says stop", async (): Promise<void> => {
      jest.useFakeTimers();

      const transport: Transport = makeTransport();

      setFetch(
        respond(
          503,
          '{"directive":"stop","reason":"budget-exhausted","retryAfterSeconds":30}',
          { "retry-after": "30" },
        ),
      );

      await transport.send(envelope, "[{}]");

      expect(directives).toEqual([
        { directive: "stop", reason: "budget-exhausted" },
      ]);
      expect(detailOf("server-directive")["directive"]).toBe("stop");

      /* Nothing waiting, and nothing scheduled to send it. */
      expect(transport.getQueueDepth()).toBe(0);
      expect(transport.getRetryDueAtUnixMs()).toBe(0);
      expect(transport.getDroppedChunkCount()).toBe(1);

      /* And a throttle it is not: no pause was reported to the customer. */
      expect(codes()).not.toContain("chunk-throttled");

      const posted: jest.Mock = globalRecord()["fetch"] as jest.Mock;
      const before: number = posted.mock.calls.length;

      jest.advanceTimersByTime(120_000);
      await Promise.resolve();

      expect(posted.mock.calls.length).toBe(before);

      jest.useRealTimers();
    });

    /*
     * A 400 the server will answer identically forever is recorded as a
     * terminal refusal naming the server's own error code, so the ticket
     * says "unsupported-wire-version" rather than "it stopped".
     */
    it("records chunk-refused-terminal with the server's error on a deterministic 400", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(
        respond(
          400,
          '{"error":"unsupported-wire-version","message":"Wire version 9 is not supported."}',
        ),
      );

      await transport.send({ ...envelope, chunkIndex: 5 }, "[{}]");

      expect(detailOf("chunk-refused-terminal")).toMatchObject({
        status: 400,
        error: "unsupported-wire-version",
        chunkIndex: 5,
      });
      expect(detailOf("transport-disabled")["reason"]).toBe(
        "http-400:unsupported-wire-version",
      );
      expect(permanentFailures).toEqual(["http-400:unsupported-wire-version"]);
    });

    /* A retry that is scheduled says when, so a paused recorder is legible. */
    it("records chunk-retry-scheduled with the pause after a retryable failure", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(respond(500));

      await transport.send(envelope, "[{}]");

      expect(detailOf("chunk-retry-scheduled")).toMatchObject({
        inMs: 15_000,
        consecutiveFailures: 1,
        maxFlushFailures: SESSION_REPLAY_MAX_FLUSH_FAILURES,
        queueDepth: 1,
      });
      expect(transport.getRetryDueAtUnixMs()).toBeGreaterThan(0);
    });

    /*
     * The transport is the one module holding the ingest credential, and it
     * is also the one writing records a customer is asked to paste into a
     * support ticket. The token must not appear in any of them - not in the
     * URL that failed, not in a rejection, not in the terminal path.
     */
    it("never writes the ingestion token into a record", async (): Promise<void> => {
      const transport: Transport = makeTransport();

      setFetch(
        respond(202, '{"directive":"stop","reason":"budget-exhausted"}'),
      );
      await transport.send(envelope, "[{}]");

      setFetch(respond(413));
      await transport.send(envelope, "[{}]");

      globalRecord()["fetch"] = jest
        .fn()
        .mockRejectedValue(new Error("offline"));
      await transport.send(envelope, "[{}]");

      /*
       * The offline failure above put the first transport into a retry
       * backoff, during which nothing is posted - so the auth failure and
       * the terminal path run on a second transport with the same token.
       */
      const second: Transport = makeTransport();

      setFetch(respond(401));
      await second.send(envelope, "[{}]");

      second.sendTerminal([
        {
          envelope: envelope,
          payload: `[${"x".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES)}]`,
        },
      ]);

      /* The gamut really did produce records before they were searched. */
      expect(codes()).toEqual(
        expect.arrayContaining([
          "chunk-accepted",
          "server-directive",
          "chunk-refused",
          "chunk-post-failed",
          "chunk-rejected-terminal",
          "transport-disabled",
        ]),
      );

      expect(serializedRecords()).not.toContain(INGEST_TOKEN);
    });
  });
});
