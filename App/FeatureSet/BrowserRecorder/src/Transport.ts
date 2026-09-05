import {
  MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST,
  MAX_SESSION_REPLAY_CHUNK_BYTES,
  SESSION_REPLAY_CONTENT_TYPE,
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SESSION_REPLAY_MAX_FLUSH_FAILURES,
  SessionReplayChunkEnvelope,
  SessionReplayDirective,
  SessionReplayPayloadEncoding,
} from "Common/Types/Rum/SessionReplay";
import { debugLog, debugWarn } from "./Debug";

/*
 * Chunk upload.
 *
 * Three decisions here are not interchangeable with the obvious
 * alternatives:
 *
 * 1. gzip via the native CompressionStream, never fflate. The server's
 *    entire decode vocabulary is "gzip" or "none" (OtelPayloadEncoding), so
 *    raw DEFLATE would be stored and later parsed as garbage. When
 *    CompressionStream is missing the payload goes up as identity and says
 *    so on the envelope.
 *
 * 2. fetch(keepalive), never navigator.sendBeacon. sendBeacon cannot set
 *    request headers, and the ingest middleware reads the auth token ONLY
 *    from headers - no body or query fallback. A beacon route would need
 *    bespoke auth for the one code path that matters least.
 *
 * 3. The terminal flush is synchronous and uncompressed. Compression is a
 *    promise chain; once a pagehide handler returns there is no guarantee
 *    the browser will keep running microtasks for a page it is discarding.
 *    Issuing one fetch inside the handler with identity encoding trades a
 *    bigger body for a request that actually leaves.
 *
 * And three properties of the retry path that the first version got wrong,
 * each of which turned a short outage into a recorder that was dead for the
 * rest of the page's life:
 *
 * 4. Sends are SERIALISED. The recorder fires send() from a 15 s timer
 *    without awaiting the previous call, so during an outage two in-flight
 *    posts could each add a strike to the same three-strike breaker. One
 *    request at a time means one strike per failed attempt, which is what
 *    "three consecutive failures" was always meant to count.
 *
 * 5. Retries run on their OWN timer, with backoff. Retrying only when the
 *    next chunk arrived meant a quiet page's last failed chunk was never
 *    retried at all, and a busy page retried instantly into the same outage.
 *
 * 6. A throttle is not a failure. The server answers 503 with a "throttle"
 *    directive and retryAfterSeconds when ITS storage is briefly unavailable,
 *    and 429 with Retry-After when the application is over its rate. Both
 *    are the server asking for patience; counting either toward the breaker
 *    self-disabled exactly the recorders the server wanted to keep.
 */

export interface TransportOptions {
  url: string;
  headers: Record<string, string>;

  /*
   * Server's instruction to a live recorder, carried on every response,
   * together with the reason it gave.
   *
   * SessionReplayChunkResponse has carried `reason` from the start, for the
   * stated purpose of letting "a recorder told to stop without a reason
   * leave the customer diagnosing silence" - and it was read by nobody. It
   * is a closed vocabulary ("budget-exhausted", "not-sampled",
   * "rate-limited", ...) with no user data in it, so it is safe to log and
   * it is exactly what a support ticket needs to quote.
   */
  onDirective: (
    directive: SessionReplayDirective,
    reason: string | null,
  ) => void;

  /*
   * The circuit breaker tripped. The recorder must stop recording and
   * release its buffer - a recorder that retries forever against a
   * misconfigured origin is a battery and bandwidth bug on someone else's
   * site.
   */
  onPermanentFailure: (reason: string) => void;

  /*
   * A chunk was too large to post even compressed, so only its size was
   * declared. The recorder discloses it on the next chunk, because the
   * viewer needs to know a snapshot is missing rather than be shown a gap.
   */
  onChunkTooLarge?: (compressedBytes: number) => void;
}

/*
 * One piece of a terminal flush: the pagehide split hands the transport all
 * of its pieces at once so they can share a single keepalive request.
 */
export interface TerminalChunk {
  envelope: SessionReplayChunkEnvelope;
  payload: string;
}

interface QueuedChunk {
  envelope: SessionReplayChunkEnvelope;
  payload: string;

  /*
   * How many times this chunk has been posted and failed retryably. A chunk
   * is given up on after MAX_ATTEMPTS_PER_CHUNK so one chunk the server can
   * never take (a corrupt frame that reads as a 5xx on a proxy, say) cannot
   * hold the queue's other seven hostage forever.
   */
  attempts: number;
}

/*
 * How one POST resolved, from the DRAIN loop's point of view:
 *
 *   accepted        the chunk landed; keep going.
 *   chunk-rejected  THIS chunk was refused (413/422/400) but the transport
 *                   is healthy; drop it, keep draining.
 *   halt            the transport itself cannot take more right now
 *                   (network failure, 5xx, throttle, breaker) — stop
 *                   draining and preserve whatever has not been posted yet.
 *
 * A boolean cannot carry the middle case, and the middle case is what
 * makes the difference between "one oversized chunk" and "every chunk
 * behind it silently gone".
 */
type PostOutcome = "accepted" | "chunk-rejected" | "halt";

/*
 * What the server said, read off any response that has a body. The same
 * shape rides on a 202, a 503 and a 400; only the 204 carries it in headers.
 */
interface ServerResponseBody {
  directive: SessionReplayDirective | null;
  reason: string | null;
  error: string | null;
  retryAfterSeconds: number | null;
}

/*
 * The shape of a directive reason. The server sends a closed vocabulary
 * ("budget-exhausted", "not-sampled", "rate-limited"), but it arrives over
 * the network and ends up in a console line a customer pastes into a support
 * ticket, so anything outside this charset is dropped rather than printed.
 */
const DIRECTIVE_REASON_PATTERN: RegExp = /^[A-Za-z0-9_.:-]+$/;

/*
 * Delay before the Nth retry round after a retryable failure. Growing, so a
 * busy page does not retry straight back into the outage that just failed
 * it, and long enough overall that the breaker below only trips on an
 * outage that has lasted the better part of a minute rather than on a blip
 * spanning two flush ticks.
 */
export const RETRY_BACKOFF_MS: Array<number> = [15_000, 45_000, 120_000];

/*
 * A retryable failure with no Retry-After anywhere on it waits this long.
 * The server's own throttle answers always carry a value, so this only
 * covers proxies and CDNs answering on the server's behalf.
 */
const DEFAULT_RETRY_AFTER_SECONDS: number = 30;
const MAX_RETRY_AFTER_SECONDS: number = 300;

/* See QueuedChunk.attempts. */
const MAX_ATTEMPTS_PER_CHUNK: number = 3;

/*
 * 400s the server will answer identically for every chunk this recorder
 * could ever send: the wire version it speaks, the application it claims to
 * be, the shape of its frames. Retrying is pointless and each retry is a
 * request on somebody else's network, so these stop the recorder outright.
 *
 * Read from the `error` field of the 400 body, which is
 * SessionReplayEnvelopeError's closed vocabulary plus the route's own two
 * pre-parse refusals.
 */
const DETERMINISTIC_REFUSALS: Array<string> = [
  "unsupported-wire-version",
  "app-identifier-mismatch",
  "missing-app-identifier",
  "malformed-body",
  "malformed-envelope",
  "missing-envelope",
];

/*
 * A 400 whose body does not name a deterministic cause is still a 400 the
 * server will most likely keep sending (an older server, a proxy rewriting
 * the body). One is dropped and forgiven; this many in a row is a
 * misconfiguration, not a bad chunk.
 */
const MAX_CONSECUTIVE_REFUSALS: number = 3;

/*
 * Uint8Array<ArrayBuffer>, not the default Uint8Array<ArrayBufferLike>. The
 * DOM's BodyInit only accepts views over a real ArrayBuffer, so the wider
 * default (which admits SharedArrayBuffer) cannot be used as a fetch body.
 */
export type PayloadBytes = Uint8Array<ArrayBuffer>;

export interface CompressionResult {
  bytes: PayloadBytes;
  encoding: SessionReplayPayloadEncoding;
}

export default class Transport {
  private readonly options: TransportOptions;

  private consecutiveFailures: number = 0;
  private consecutiveRefusals: number = 0;
  private disabled: boolean = false;
  private disabledReason: string = "";
  private throttledUntilUnixMs: number = 0;
  private backoffUntilUnixMs: number = 0;
  private droppedChunks: number = 0;

  /*
   * Chunks that failed retryably. Bounded by the per-request frame cap: a
   * recorder that hoards a growing backlog of end-user content in memory is
   * both a memory leak and a privacy problem.
   */
  private retryQueue: Array<QueuedChunk> = [];

  /*
   * Property 4 above: the operation in flight, if any. A send that finds
   * nothing in flight starts synchronously (the recorder fires send() from a
   * timer and never awaits it, and every microtask hop between "chunk closed"
   * and "request on the wire" is a hop a pagehide can interrupt); a send that
   * finds one waits for it.
   */
  private inFlight: Promise<void> | null = null;

  /* Property 5: the retry timer, and when it is due. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDueAtUnixMs: number = 0;

  public constructor(options: TransportOptions) {
    this.options = options;
  }

  public isDisabled(): boolean {
    return this.disabled;
  }

  public getDisabledReason(): string {
    return this.disabledReason;
  }

  public getFlushFailureCount(): number {
    return this.consecutiveFailures;
  }

  public getDroppedChunkCount(): number {
    return this.droppedChunks;
  }

  public isThrottled(nowUnixMs: number = Date.now()): boolean {
    return nowUnixMs < this.throttledUntilUnixMs;
  }

  /* Waiting out a retry backoff after a retryable failure. */
  public isBackingOff(nowUnixMs: number = Date.now()): boolean {
    return nowUnixMs < this.backoffUntilUnixMs;
  }

  public getQueueDepth(): number {
    return this.retryQueue.length;
  }

  /* When the next unattended retry will run, or 0 when none is scheduled. */
  public getRetryDueAtUnixMs(): number {
    return this.retryTimer === null ? 0 : this.retryDueAtUnixMs;
  }

  /*
   * gzip when the platform has CompressionStream, identity when it does
   * not. Never a third option: the server understands exactly these two.
   */
  public static async compress(text: string): Promise<CompressionResult> {
    const raw: PayloadBytes = new TextEncoder().encode(text);

    const globalRecord: Record<string, unknown> =
      globalThis as unknown as Record<string, unknown>;

    if (typeof globalRecord["CompressionStream"] !== "function") {
      return { bytes: raw, encoding: "identity" };
    }

    try {
      const stream: CompressionStream = new CompressionStream("gzip");
      const writer: WritableStreamDefaultWriter<BufferSource> =
        stream.writable.getWriter();

      /*
       * The write is deliberately not awaited before close(): awaiting it
       * deadlocks when the readable side has not been drained yet, because
       * the writer's promise only settles once the transform has somewhere
       * to put the output.
       *
       * Both rejections ARE handled, though, even while nothing awaits them.
       * A discarded rejection surfaces as `unhandledrejection` on the
       * customer's page, where their own error tracker reports it as their
       * bug - and where our own ErrorRecorder catches it and treats it as a
       * reason to start uploading. The real failure is still observed by the
       * arrayBuffer() read below, which falls back to identity.
       */
      writer.write(raw).catch((): void => {
        /* Observed by the arrayBuffer() read below. */
      });
      writer.close().catch((): void => {
        /* Observed by the arrayBuffer() read below. */
      });

      const compressed: ArrayBuffer = await new Response(
        stream.readable,
      ).arrayBuffer();

      return { bytes: new Uint8Array(compressed), encoding: "gzip" };
    } catch {
      return { bytes: raw, encoding: "identity" };
    }
  }

  /*
   * Body layout: the envelope JSON, one 0x0A byte, then the payload bytes.
   * The envelope stays in the body rather than being spread across custom
   * headers because every extra request header widens the CORS preflight
   * surface, and splitting on the first newline plus parsing a ~300 byte
   * JSON object costs microseconds.
   *
   * A body may carry several such frames back to back (up to
   * MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST); the parser reads each envelope's
   * payloadBytes to find the next one. sendTerminal uses that to carry the
   * retry queue out with the final chunk.
   */
  public static buildBody(
    envelope: SessionReplayChunkEnvelope,
    payloadBytes: PayloadBytes,
  ): PayloadBytes {
    const header: PayloadBytes = new TextEncoder().encode(
      `${JSON.stringify(envelope)}\n`,
    );

    const body: PayloadBytes = new Uint8Array(
      header.length + payloadBytes.length,
    );

    body.set(header, 0);
    body.set(payloadBytes, header.length);

    return body;
  }

  /*
   * Normal (non-terminal) send. Joins the serialised chain; drains the retry
   * queue first so chunks arrive in index order wherever possible. Resolves
   * true only when THIS chunk was accepted.
   */
  public send(
    envelope: SessionReplayChunkEnvelope,
    payload: string,
  ): Promise<boolean> {
    const chunk: QueuedChunk = {
      envelope: envelope,
      payload: payload,
      attempts: 0,
    };

    const result: Promise<boolean> =
      this.inFlight === null
        ? this.sendSerialised(chunk)
        : this.inFlight.then((): Promise<boolean> => {
            return this.sendSerialised(chunk);
          });

    this.trackInFlight(result);

    return result;
  }

  /*
   * Everything joins one line. The in-flight marker is cleared only by the
   * operation that set it, so a later joiner cannot be orphaned by an earlier
   * one finishing.
   */
  private trackInFlight(operation: Promise<unknown>): void {
    const clear: () => void = (): void => {
      if (this.inFlight === settled) {
        this.inFlight = null;
      }
    };

    const settled: Promise<void> = operation.then(clear, clear);

    this.inFlight = settled;
  }

  private async sendSerialised(current: QueuedChunk): Promise<boolean> {
    try {
      if (this.disabled) {
        this.droppedChunks++;
        return false;
      }

      /*
       * Paused, either by the server (throttle) or by our own backoff. The
       * chunk waits its turn on the retry timer rather than being posted into
       * a window the server asked us to stay out of.
       */
      if (this.isPaused()) {
        this.enqueueForRetry(current);
        this.scheduleDrain(this.pausedUntilUnixMs());
        return false;
      }

      const drained: PostOutcome =
        this.retryQueue.length > 0 ? await this.drainQueueNow() : "accepted";

      if (this.disabled) {
        this.droppedChunks++;
        return false;
      }

      /*
       * A throttle or a retryable failure received mid-drain applies to the
       * CURRENT chunk too. Posting it anyway would violate the throttle one
       * request after receiving it, or add a second strike for one outage.
       */
      if (drained === "halt") {
        this.enqueueForRetry(current);
        this.scheduleDrain(this.pausedUntilUnixMs());
        return false;
      }

      return (await this.post(current)) === "accepted";
    } catch {
      /*
       * Nothing in here is allowed to reject: this is the promise the
       * recorder fires from a timer and never awaits, so a rejection would
       * be an unhandledrejection on the customer's page.
       */
      return false;
    }
  }

  /*
   * Post everything queued, in order, until something halts the transport.
   * Returns "halt" when the caller must not post anything further right now.
   */
  private async drainQueueNow(): Promise<PostOutcome> {
    const queued: Array<QueuedChunk> = this.retryQueue;
    this.retryQueue = [];

    for (let index: number = 0; index < queued.length; index++) {
      const outcome: PostOutcome = await this.post(queued[index]!);

      /*
       * A rejected CHUNK (413/422/400) is not a rejected TRANSPORT: that
       * one chunk is dropped and counted, and the drain continues — the
       * next chunk may be perfectly acceptable.
       */
      if (outcome === "chunk-rejected") {
        continue;
      }

      if (outcome === "halt") {
        /*
         * Stop draining on a transport-level failure. The chunk that
         * failed was already re-enqueued (retryable, throttled) or dropped
         * (breaker tripped), but the chunks BEHIND it in the drained
         * array were neither posted nor back in the queue — losing them
         * silently was exactly the bug. Restore them in index order, or
         * count them when the breaker just cleared the queue for good.
         */
        const remainder: Array<QueuedChunk> = queued.slice(index + 1);

        if (this.disabled) {
          this.droppedChunks += remainder.length;
        } else {
          for (const chunk of remainder) {
            this.enqueueForRetry(chunk);
          }
        }

        return "halt";
      }
    }

    return "accepted";
  }

  /*
   * The unattended retry: what the timer runs. Joins the chain like send()
   * so it can never overlap a post the recorder started.
   */
  private drainLater(): void {
    const run: () => Promise<void> = async (): Promise<void> => {
      try {
        if (this.disabled || this.retryQueue.length === 0) {
          return;
        }

        if (this.isPaused()) {
          this.scheduleDrain(this.pausedUntilUnixMs());
          return;
        }

        debugLog("chunk-retry", "Retrying queued chunks.", {
          queueDepth: this.retryQueue.length,
          consecutiveFailures: this.consecutiveFailures,
        });

        await this.drainQueueNow();
      } catch {
        /* See sendSerialised. */
      }
    };

    this.trackInFlight(
      this.inFlight === null ? run() : this.inFlight.then(run),
    );
  }

  /*
   * Terminal flush. Synchronous by construction, identity-encoded, ONE
   * request, hard-capped at the keepalive quota.
   *
   * The keepalive quota is 64 KB COMBINED per origin across all in-flight
   * keepalive requests, so "two 48 KB posts" fails against the very limit
   * that motivates it - and it fails by REJECTING the later requests, which
   * is precisely the sealing frame. That is why this takes the whole split
   * as an array rather than one piece at a time: the pieces go out as
   * frames of a single request, and what does not fit is counted rather
   * than thrown at a quota that will refuse it.
   *
   * Priority when it does not all fit: the LAST piece first (it carries
   * isFinal, the per-chunk signals, the trace ids and the routes - it is
   * what seals the session), then the pieces before it newest-first (the
   * footage closest to the moment the user left is the footage the session
   * was captured for), then the retry queue oldest-first. The page is going
   * away and nothing else will ever post those, so anything left over is an
   * acknowledged loss recorded as a dropped chunk.
   */
  public sendTerminal(chunks: Array<TerminalChunk>): boolean {
    if (chunks.length === 0) {
      return false;
    }

    if (this.disabled) {
      this.droppedChunks += chunks.length;
      return false;
    }

    const queued: Array<QueuedChunk> = this.retryQueue;
    this.retryQueue = [];
    this.cancelDrain();

    /*
     * Sealing frame first, then the rest of the split newest-first, then
     * the retry queue oldest-first. Built in priority order; the body is
     * assembled in chunkIndex order afterwards.
     */
    const candidates: Array<TerminalChunk> = [
      chunks[chunks.length - 1] as TerminalChunk,
    ];

    for (let index: number = chunks.length - 2; index >= 0; index--) {
      candidates.push(chunks[index] as TerminalChunk);
    }

    for (const chunk of queued) {
      candidates.push({ envelope: chunk.envelope, payload: chunk.payload });
    }

    const selected: Array<{ frame: PayloadBytes; chunkIndex: number }> = [];
    let totalBytes: number = 0;
    let dropped: number = 0;

    /* Size of the sealing frame, for the diagnostics when it is the one lost. */
    let sealingBytes: number = 0;

    for (let index: number = 0; index < candidates.length; index++) {
      const candidate: TerminalChunk = candidates[index] as TerminalChunk;
      const frame: PayloadBytes = Transport.buildIdentityFrame(
        candidate.envelope,
        candidate.payload,
      );

      if (index === 0) {
        sealingBytes = frame.length;
      }

      if (
        totalBytes + frame.length > SESSION_REPLAY_KEEPALIVE_MAX_BYTES ||
        selected.length >= MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST
      ) {
        dropped++;
        continue;
      }

      selected.push({
        frame: frame,
        chunkIndex: candidate.envelope.chunkIndex,
      });
      totalBytes += frame.length;
    }

    this.droppedChunks += dropped;

    if (selected.length === 0) {
      debugWarn(
        "final-chunk-too-large",
        "The final chunk was over the keepalive quota and was dropped.",
        {
          bytes: sealingBytes,
          maxBytes: SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
          droppedChunks: dropped,
        },
      );

      return false;
    }

    if (dropped > 0) {
      debugWarn(
        "final-flush-partial",
        "The keepalive quota could not carry every chunk; the rest were dropped.",
        {
          sent: selected.length,
          dropped: dropped,
          bytes: totalBytes,
          maxBytes: SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
        },
      );
    } else if (selected.length > 1) {
      debugLog(
        "final-chunk-carried-queue",
        "Several chunks were sent as frames of the final request.",
        {
          frames: selected.length,
          bytes: totalBytes,
        },
      );
    }

    /* The server reads frames in body order; ascending index keeps it sane. */
    selected.sort(
      (
        left: { frame: PayloadBytes; chunkIndex: number },
        right: { frame: PayloadBytes; chunkIndex: number },
      ): number => {
        return left.chunkIndex - right.chunkIndex;
      },
    );

    const body: PayloadBytes = new Uint8Array(totalBytes);
    let offset: number = 0;

    for (const entry of selected) {
      body.set(entry.frame, offset);
      offset += entry.frame.length;
    }

    try {
      /*
       * The returned promise is intentionally not awaited: the page is
       * going away, and keepalive means the browser completes the request
       * without the document. A rejection here is unobservable and must not
       * surface as an unhandled rejection on the customer's page.
       */
      void fetch(this.options.url, {
        method: "POST",
        keepalive: true,
        headers: this.buildHeaders(),
        body: body,
        credentials: "omit",
        mode: "cors",
      }).catch((): void => {
        /* Nothing to do: there is no next flush. */
      });

      return true;
    } catch {
      this.droppedChunks += selected.length;
      return false;
    }
  }

  private static buildIdentityFrame(
    envelope: SessionReplayChunkEnvelope,
    payload: string,
  ): PayloadBytes {
    const payloadBytes: PayloadBytes = new TextEncoder().encode(payload);

    return Transport.buildBody(
      {
        ...envelope,
        payloadEncoding: "identity",
        payloadBytes: payloadBytes.length,
      },
      payloadBytes,
    );
  }

  private async post(chunk: QueuedChunk): Promise<PostOutcome> {
    const compressed: CompressionResult = await Transport.compress(
      chunk.payload,
    );

    const envelope: SessionReplayChunkEnvelope = {
      ...chunk.envelope,
      payloadEncoding: compressed.encoding,
      payloadBytes: compressed.bytes.length,
      flushFailures: this.consecutiveFailures,
    };

    /*
     * Over the per-request cap even after gzip - an indivisible full
     * snapshot of a very large DOM. The SIZE is declared and the bytes are
     * not sent: the parser checks payloadBytes before it reads any payload
     * and answers 422 (the session survives, with a disclosure) rather than
     * the 413 the real bytes would earn from nginx or the middleware's byte
     * counter, and the customer's page does not spend megabytes of the
     * visitor's uplink on a request that cannot be accepted.
     */
    const tooLarge: boolean =
      compressed.bytes.length > MAX_SESSION_REPLAY_CHUNK_BYTES;

    if (tooLarge) {
      debugWarn(
        "chunk-too-large",
        "A chunk was over the request size limit even compressed; only its size was sent.",
        {
          chunkIndex: envelope.chunkIndex,
          bytes: compressed.bytes.length,
          maxBytes: MAX_SESSION_REPLAY_CHUNK_BYTES,
        },
      );

      if (this.options.onChunkTooLarge) {
        this.options.onChunkTooLarge(compressed.bytes.length);
      }
    }

    const body: PayloadBytes = Transport.buildBody(
      envelope,
      tooLarge ? new Uint8Array(0) : compressed.bytes,
    );

    let response: Response | null = null;

    try {
      response = await fetch(this.options.url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: body,
        credentials: "omit",
        mode: "cors",
      });
    } catch {
      /* Network-level failure: retryable, and it counts against the breaker. */
      debugWarn(
        "chunk-post-failed",
        "A chunk upload never reached the server.",
        {
          url: this.options.url,
          chunkIndex: chunk.envelope.chunkIndex,
          consecutiveFailures: this.consecutiveFailures + 1,
        },
      );

      this.recordRetryableFailure(chunk);
      return "halt";
    }

    return this.handleResponse(response, chunk, envelope);
  }

  /*
   * `sent` is the envelope that actually went on the wire - the caller's
   * envelope with the post-compression encoding and byte count written into
   * it. The diagnostics report from `sent`, so the number a support engineer
   * reads is the number the server received.
   */
  private async handleResponse(
    response: Response,
    chunk: QueuedChunk,
    sent: SessionReplayChunkEnvelope,
  ): Promise<PostOutcome> {
    const status: number = response.status;

    if (status >= 200 && status < 300) {
      this.consecutiveFailures = 0;
      this.consecutiveRefusals = 0;
      this.backoffUntilUnixMs = 0;

      /*
       * 204 is NOT an accepted chunk. It is the status the server sends when
       * it deliberately did not record - over budget, unsampled, application
       * disabled, session chunk cap - and it carries the directive and the
       * reason in headers rather than a body. The server's own metrics
       * middleware refuses the same conflation in as many words ("204 is
       * counted as 'refused' rather than 'accepted'"), and the docs teach a
       * customer to look for "chunk-accepted" as proof their installation
       * works, so calling a stand-down an acceptance would confirm an
       * installation that is storing nothing.
       *
       * payloadBytes comes from `sent`, not from chunk.envelope: the
       * caller's envelope carries the RAW count and post() replaces it with
       * the post-gzip length before the request goes out. Reporting the raw
       * one would show a support engineer a different number from the one
       * the server received for the same chunk.
       */
      if (status === 204) {
        debugWarn(
          "chunk-not-recorded",
          "The server accepted the request but deliberately did not record the chunk.",
          { status: status, chunkIndex: sent.chunkIndex },
        );
      } else {
        debugLog("chunk-accepted", "Chunk accepted.", {
          status: status,
          chunkIndex: sent.chunkIndex,
          sessionId: sent.sessionId,
          payloadBytes: sent.payloadBytes,
          payloadEncoding: sent.payloadEncoding,
          isFinal: sent.isFinal,
        });
      }

      await this.applyDirective(response);
      return "accepted";
    }

    /*
     * Every non-2xx answer the server writes itself carries the same JSON
     * shape as a 2xx: directive, reason, and on a throttle retryAfterSeconds.
     * Read it ONCE here so the branches below can act on what the server
     * actually said instead of guessing from the status alone.
     */
    const said: ServerResponseBody = await Transport.readBody(response);

    /*
     * Auth is broken or the endpoint does not exist. Retrying cannot fix
     * either, and hammering a customer's network to prove it is worse than
     * going quiet.
     */
    if (status === 401 || status === 403 || status === 404) {
      /*
       * The three statuses that stop the recorder for good, each with a fix
       * in a different place. Until now this produced a recorder that simply
       * went quiet mid-session with nothing printed anywhere.
       */
      debugWarn(
        "chunk-rejected-terminal",
        "Uploading stopped for good: the server refused this recorder.",
        {
          status: status,
          url: this.options.url,
          reason: said.reason || said.error || "not-reported",
        },
      );

      this.disable(`http-${status}`);
      return "halt";
    }

    /*
     * The chunk itself was rejected: too large, or a snapshot that cannot be
     * accepted. Dropping this one chunk is correct, and it must NOT count
     * against the circuit breaker - the transport is healthy.
     */
    if (status === 413 || status === 422) {
      debugWarn(
        "chunk-refused",
        "The server refused one chunk; recording continues without it.",
        {
          status: status,
          chunkIndex: sent.chunkIndex,
          payloadBytes: sent.payloadBytes,
          error: said.error || "not-reported",
        },
      );

      this.droppedChunks++;
      return "chunk-rejected";
    }

    if (status === 400) {
      return this.handleRefusal(said, sent);
    }

    if (status === 429 || Transport.isThrottleAnswer(said, response)) {
      return this.throttle(chunk, said, response, status);
    }

    debugWarn(
      "chunk-post-server-error",
      "The server could not accept a chunk. It will be retried.",
      {
        status: status,
        chunkIndex: sent.chunkIndex,
        consecutiveFailures: this.consecutiveFailures + 1,
        maxFlushFailures: SESSION_REPLAY_MAX_FLUSH_FAILURES,
      },
    );

    this.recordRetryableFailure(chunk);

    return "halt";
  }

  /*
   * A 400 is the server saying "I understood you and the answer is no". It
   * is per-chunk only when the body says so; when the body names something
   * about the RECORDER (its wire version, its application, its framing) the
   * next chunk will get exactly the same answer, and so will the one after.
   */
  private handleRefusal(
    said: ServerResponseBody,
    sent: SessionReplayChunkEnvelope,
  ): PostOutcome {
    if (said.directive === "stop") {
      debugWarn(
        "server-directive",
        "The server changed what this recorder should do.",
        { directive: "stop", reason: said.reason || "not-reported" },
      );

      this.options.onDirective("stop", said.reason);
      this.droppedChunks++;
      return "halt";
    }

    if (said.error && DETERMINISTIC_REFUSALS.includes(said.error)) {
      debugWarn(
        "chunk-refused-terminal",
        "The server will refuse every chunk from this recorder. Uploading has stopped.",
        { status: 400, error: said.error, chunkIndex: sent.chunkIndex },
      );

      this.droppedChunks++;
      this.disable(`http-400:${said.error}`);
      return "halt";
    }

    this.droppedChunks++;
    this.consecutiveRefusals++;

    debugWarn(
      "chunk-refused",
      "The server refused one chunk; recording continues without it.",
      {
        status: 400,
        chunkIndex: sent.chunkIndex,
        payloadBytes: sent.payloadBytes,
        error: said.error || "not-reported",
        consecutiveRefusals: this.consecutiveRefusals,
      },
    );

    if (this.consecutiveRefusals >= MAX_CONSECUTIVE_REFUSALS) {
      debugWarn(
        "chunk-refused-terminal",
        "Every recent chunk was refused as malformed. Uploading has stopped.",
        {
          status: 400,
          consecutiveRefusals: this.consecutiveRefusals,
          error: said.error || "not-reported",
        },
      );

      this.disable("http-400-repeated");
      return "halt";
    }

    return "chunk-rejected";
  }

  /*
   * A 503 is only a throttle when the server SAYS so: a throttle directive,
   * a retryAfterSeconds in the body, or a Retry-After header. A bare 5xx
   * from a proxy in front of a dead server carries none of those and is a
   * failure like any other.
   */
  private static isThrottleAnswer(
    said: ServerResponseBody,
    response: Response,
  ): boolean {
    if (said.directive === "throttle" || said.retryAfterSeconds !== null) {
      return true;
    }

    try {
      return Boolean(response.headers && response.headers.get("retry-after"));
    } catch {
      return false;
    }
  }

  private throttle(
    chunk: QueuedChunk,
    said: ServerResponseBody,
    response: Response,
    status: number,
  ): PostOutcome {
    const retryAfterSeconds: number =
      said.retryAfterSeconds !== null
        ? Math.min(said.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS)
        : Transport.parseRetryAfter(response);

    if (said.directive === "stop") {
      /*
       * A stop on a 429/503 is still a stop. Notifying and THEN re-queueing
       * the chunk put one more request of page content on the wire after
       * Recorder.shutdown had already discarded the queue - the one request
       * the operator's kill switch explicitly asked not to receive. The
       * chunk is dropped and counted, exactly as handleRefusal does with a
       * stop on a 400.
       */
      debugWarn(
        "server-directive",
        "The server changed what this recorder should do.",
        {
          directive: "stop",
          reason: said.reason || "not-reported",
          status: status,
        },
      );

      this.options.onDirective("stop", said.reason);
      this.droppedChunks++;

      return "halt";
    }

    debugWarn(
      "chunk-throttled",
      "Rate limited. Uploads pause and resume on their own.",
      {
        status: status,
        retryAfterSeconds: retryAfterSeconds,
        reason: said.reason || "not-reported",
      },
    );

    if (said.directive === "throttle") {
      this.options.onDirective(said.directive, said.reason);
    }

    this.throttledUntilUnixMs = Date.now() + retryAfterSeconds * 1000;

    /*
     * A healthy server asking us to slow down is not a failure. Counting
     * it would self-disable exactly the recorders on the busiest sites.
     * The chunk waits, without an attempt against its name.
     */
    this.enqueueForRetry(chunk);
    this.scheduleDrain(this.throttledUntilUnixMs);

    return "halt";
  }

  private async applyDirective(response: Response): Promise<void> {
    try {
      const said: ServerResponseBody = await Transport.readBody(response);

      /*
       * A 204 has NO BODY, and 204 is precisely the status the server sends
       * when it is standing a recorder down - deliberately not recording,
       * over budget, unsampled, rate limited. It puts the directive in
       * x-oneuptime-replay-directive and the reason in
       * x-oneuptime-replay-reason for that case, and CorsOptions exposes
       * both cross-origin specifically so the recorder can read them.
       *
       * This method only ever parsed the body and returned early when it was
       * empty, so every one of those responses was read as a plain success:
       * the kill switch's fast path did not work, and the recorder kept
       * posting chunks the server had already told it to stop sending.
       */
      if (said.directive === null && said.retryAfterSeconds === null) {
        this.applyHeaderDirective(response);
        return;
      }

      if (said.directive !== null) {
        if (said.directive !== "continue") {
          debugWarn(
            "server-directive",
            "The server changed what this recorder should do.",
            {
              directive: said.directive,
              reason: said.reason || "not-reported",
            },
          );
        }

        this.options.onDirective(said.directive, said.reason);
      }

      if (said.retryAfterSeconds !== null) {
        this.throttledUntilUnixMs =
          Date.now() +
          Math.min(said.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS) * 1000;
      }
    } catch {
      /*
       * A 2xx with an unreadable body is still a successful upload. The
       * directive is an optimisation, not a requirement.
       */
    }
  }

  /*
   * The bodyless case. Reads the three headers CorsOptions exposes, all of
   * which are absent on a same-origin-shaped or older server - in which case
   * nothing happens, which is the pre-existing behaviour.
   */
  private applyHeaderDirective(response: Response): void {
    if (!response.headers) {
      return;
    }

    const directive: string | null = response.headers.get(
      "x-oneuptime-replay-directive",
    );

    const reason: string | null = Transport.readReason(
      response.headers.get("x-oneuptime-replay-reason"),
    );

    if (
      directive !== "stop" &&
      directive !== "throttle" &&
      directive !== "continue"
    ) {
      return;
    }

    if (directive !== "continue") {
      debugWarn(
        "server-directive",
        "The server told this recorder to change what it is doing.",
        {
          directive: directive,
          reason: reason || "not-reported",
          via: "header",
        },
      );
    }

    this.options.onDirective(directive, reason);
  }

  /*
   * Read what the server said, from any status. Never throws: a response
   * whose body is missing, empty, or not JSON simply said nothing.
   */
  private static async readBody(
    response: Response,
  ): Promise<ServerResponseBody> {
    const nothing: ServerResponseBody = {
      directive: null,
      reason: null,
      error: null,
      retryAfterSeconds: null,
    };

    try {
      if (typeof response.text !== "function") {
        return nothing;
      }

      const text: string = await response.text();

      if (!text) {
        return nothing;
      }

      const body: unknown = JSON.parse(text);

      if (!body || typeof body !== "object") {
        return nothing;
      }

      const raw: Record<string, unknown> = body as Record<string, unknown>;
      const directive: unknown = raw["directive"];
      const retryAfterSeconds: unknown = raw["retryAfterSeconds"];

      return {
        directive:
          directive === "stop" ||
          directive === "throttle" ||
          directive === "continue"
            ? directive
            : null,
        reason: Transport.readReason(raw["reason"]),
        error: Transport.readReason(raw["error"]),
        retryAfterSeconds:
          typeof retryAfterSeconds === "number" &&
          Number.isFinite(retryAfterSeconds) &&
          retryAfterSeconds > 0
            ? retryAfterSeconds
            : null,
      };
    } catch {
      return nothing;
    }
  }

  /*
   * A closed server-side vocabulary, but it arrives over the wire, so it is
   * bounded and character-restricted here before it is ever logged.
   *
   * REJECTED rather than truncated when it is too long. Slicing first and
   * testing the slice let a 300-character string made only of vocabulary
   * characters through as its first 64 - which is not a member of the
   * vocabulary, matches nothing a reader could branch on, and is 64
   * characters of someone else's choosing landing in a console line.
   */
  private static readReason(value: unknown): string | null {
    if (typeof value !== "string" || !value || value.length > 64) {
      return null;
    }

    return DIRECTIVE_REASON_PATTERN.test(value) ? value : null;
  }

  private recordRetryableFailure(chunk: QueuedChunk): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= SESSION_REPLAY_MAX_FLUSH_FAILURES) {
      this.droppedChunks++;
      this.disable("max-flush-failures");
      return;
    }

    chunk.attempts++;

    if (chunk.attempts >= MAX_ATTEMPTS_PER_CHUNK) {
      debugWarn(
        "chunk-abandoned",
        "One chunk failed too many times and was dropped; uploading continues.",
        { chunkIndex: chunk.envelope.chunkIndex, attempts: chunk.attempts },
      );

      this.droppedChunks++;
    } else {
      this.enqueueForRetry(chunk);
    }

    const backoffMs: number =
      RETRY_BACKOFF_MS[
        Math.min(this.consecutiveFailures - 1, RETRY_BACKOFF_MS.length - 1)
      ] || DEFAULT_RETRY_AFTER_SECONDS * 1000;

    this.backoffUntilUnixMs = Date.now() + backoffMs;

    debugLog(
      "chunk-retry-scheduled",
      "Uploading will be retried after a pause.",
      {
        inMs: backoffMs,
        consecutiveFailures: this.consecutiveFailures,
        maxFlushFailures: SESSION_REPLAY_MAX_FLUSH_FAILURES,
        queueDepth: this.retryQueue.length,
      },
    );

    this.scheduleDrain(this.backoffUntilUnixMs);
  }

  private enqueueForRetry(chunk: QueuedChunk): void {
    if (this.retryQueue.length >= MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST) {
      /*
       * Drop the OLDEST queued chunk. The most recent seconds are the ones
       * closest to whatever went wrong, so they are the ones worth keeping.
       */
      this.retryQueue.shift();
      this.droppedChunks++;
    }

    this.retryQueue.push(chunk);
  }

  private isPaused(nowUnixMs: number = Date.now()): boolean {
    return this.isThrottled(nowUnixMs) || this.isBackingOff(nowUnixMs);
  }

  private pausedUntilUnixMs(): number {
    return Math.max(this.throttledUntilUnixMs, this.backoffUntilUnixMs);
  }

  /*
   * Arrange for the queue to be drained at `atUnixMs` with nobody calling
   * send(). One timer at a time; an earlier due time replaces a later one,
   * never the other way round.
   */
  private scheduleDrain(atUnixMs: number): void {
    if (this.disabled || this.retryQueue.length === 0) {
      return;
    }

    if (this.retryTimer !== null) {
      if (atUnixMs >= this.retryDueAtUnixMs) {
        return;
      }

      this.cancelDrain();
    }

    const delayMs: number = Math.max(0, atUnixMs - Date.now());

    this.retryDueAtUnixMs = atUnixMs;
    this.retryTimer = setTimeout((): void => {
      this.retryTimer = null;
      this.retryDueAtUnixMs = 0;
      this.drainLater();
    }, delayMs);
  }

  private cancelDrain(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.retryDueAtUnixMs = 0;
  }

  /*
   * Drop everything queued for retry, without sending it, and stop the
   * retry timer.
   *
   * The retry queue holds up to MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST fully
   * serialised chunks of end-user page content. disable() already clears it,
   * but revokeConsent() and stop() do not go through disable(), so without
   * this the "revokeConsent() drops the buffer" contract held for the rolling
   * buffer and not for the part of the buffer that had already been handed to
   * the transport. Nothing will ever upload those chunks, so retaining them
   * is pure liability.
   */
  public discardQueue(): void {
    this.retryQueue = [];
    this.backoffUntilUnixMs = 0;
    this.cancelDrain();
  }

  private disable(reason: string): void {
    if (this.disabled) {
      return;
    }

    this.disabled = true;
    this.disabledReason = reason;

    debugWarn(
      "transport-disabled",
      "Uploading has stopped for good. Fix the cause and reload.",
      {
        reason: reason,
        queuedChunksDropped: this.retryQueue.length,
        droppedChunks: this.droppedChunks,
      },
    );

    this.droppedChunks += this.retryQueue.length;
    this.retryQueue = [];
    this.cancelDrain();

    this.options.onPermanentFailure(reason);
  }

  /*
   * No Content-Encoding header, ever. The body is `<envelope JSON>\n<payload>`
   * and only the PAYLOAD is gzipped, so "Content-Encoding: gzip" would
   * describe a body that is not gzip. The server never read the header (the
   * envelope's payloadEncoding is what its parser branches on), but any
   * proxy, CDN or WAF between the page and the server that honours it would
   * try to inflate the envelope line and reject or corrupt every chunk.
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.options.headers };

    headers["Content-Type"] = SESSION_REPLAY_CONTENT_TYPE;

    return headers;
  }

  public static parseRetryAfter(response: Response): number {
    let header: string | null = null;

    try {
      header = response.headers ? response.headers.get("retry-after") : null;
    } catch {
      header = null;
    }

    if (!header) {
      return DEFAULT_RETRY_AFTER_SECONDS;
    }

    const seconds: number = Number.parseInt(header, 10);

    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
    }

    /* Retry-After may also be an HTTP date. */
    const asDate: number = Date.parse(header);

    if (Number.isFinite(asDate)) {
      return Math.max(
        1,
        Math.min(
          MAX_RETRY_AFTER_SECONDS,
          Math.round((asDate - Date.now()) / 1000),
        ),
      );
    }

    return DEFAULT_RETRY_AFTER_SECONDS;
  }
}
