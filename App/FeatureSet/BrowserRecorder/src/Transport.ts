import {
  MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST,
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
}

interface QueuedChunk {
  envelope: SessionReplayChunkEnvelope;
  payload: string;
}

/*
 * How one POST resolved, from the DRAIN loop's point of view:
 *
 *   accepted        the chunk landed; keep going.
 *   chunk-rejected  THIS chunk was refused (413/422/400) but the transport
 *                   is healthy; drop it, keep draining.
 *   halt            the transport itself cannot take more right now
 *                   (network failure, 5xx, 429, breaker) — stop draining
 *                   and preserve whatever has not been posted yet.
 *
 * A boolean cannot carry the middle case, and the middle case is what
 * makes the difference between "one oversized chunk" and "every chunk
 * behind it silently gone".
 */
type PostOutcome = "accepted" | "chunk-rejected" | "halt";

/*
 * The shape of a directive reason. The server sends a closed vocabulary
 * ("budget-exhausted", "not-sampled", "rate-limited"), but it arrives over
 * the network and ends up in a console line a customer pastes into a support
 * ticket, so anything outside this charset is dropped rather than printed.
 */
const DIRECTIVE_REASON_PATTERN: RegExp = /^[A-Za-z0-9_.:-]+$/;

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
  private disabled: boolean = false;
  private disabledReason: string = "";
  private throttledUntilUnixMs: number = 0;
  private droppedChunks: number = 0;

  /*
   * Chunks that failed retryably. Bounded by the per-request frame cap: a
   * recorder that hoards a growing backlog of end-user content in memory is
   * both a memory leak and a privacy problem.
   */
  private retryQueue: Array<QueuedChunk> = [];

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

  public getQueueDepth(): number {
    return this.retryQueue.length;
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
   * Normal (non-terminal) send. Drains the retry queue first so chunks
   * arrive in index order wherever possible.
   */
  public async send(
    envelope: SessionReplayChunkEnvelope,
    payload: string,
  ): Promise<boolean> {
    if (this.disabled) {
      this.droppedChunks++;
      return false;
    }

    if (this.isThrottled()) {
      this.enqueueForRetry({ envelope: envelope, payload: payload });
      return false;
    }

    const queued: Array<QueuedChunk> = this.retryQueue;
    this.retryQueue = [];

    for (let index: number = 0; index < queued.length; index++) {
      const outcome: PostOutcome = await this.post(queued[index]!, false);

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
         * failed was already re-enqueued (retryable, 429) or dropped
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

        break;
      }
    }

    if (this.disabled) {
      this.droppedChunks++;
      return false;
    }

    /*
     * A 429 received mid-drain throttles the CURRENT chunk too. Posting it
     * anyway would violate the throttle one request after receiving it.
     */
    if (this.isThrottled()) {
      this.enqueueForRetry({ envelope: envelope, payload: payload });
      return false;
    }

    return (
      (await this.post({ envelope: envelope, payload: payload }, false)) ===
      "accepted"
    );
  }

  /*
   * Terminal flush. Synchronous by construction, identity-encoded, one
   * request, hard-capped at the keepalive quota.
   *
   * The keepalive quota is 64 KB COMBINED per origin across all in-flight
   * keepalive requests, so "two 48 KB posts" fails against the very limit
   * that motivates it. One request under the cap, and anything above it is
   * an acknowledged loss recorded as a dropped chunk.
   */
  public sendTerminal(
    envelope: SessionReplayChunkEnvelope,
    payload: string,
  ): boolean {
    if (this.disabled) {
      this.droppedChunks++;
      return false;
    }

    const payloadBytes: PayloadBytes = new TextEncoder().encode(payload);

    const terminalEnvelope: SessionReplayChunkEnvelope = {
      ...envelope,
      payloadEncoding: "identity",
      payloadBytes: payloadBytes.length,
    };

    const body: PayloadBytes = Transport.buildBody(
      terminalEnvelope,
      payloadBytes,
    );

    if (body.length > SESSION_REPLAY_KEEPALIVE_MAX_BYTES) {
      debugWarn(
        "final-chunk-too-large",
        "The final chunk was over the keepalive quota and was dropped.",
        { bytes: body.length, maxBytes: SESSION_REPLAY_KEEPALIVE_MAX_BYTES },
      );

      this.droppedChunks++;
      return false;
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
        headers: this.buildHeaders("identity"),
        body: body,
        credentials: "omit",
        mode: "cors",
      }).catch((): void => {
        /* Nothing to do: there is no next flush. */
      });

      return true;
    } catch {
      this.droppedChunks++;
      return false;
    }
  }

  private async post(
    chunk: QueuedChunk,
    isRetry: boolean,
  ): Promise<PostOutcome> {
    const compressed: CompressionResult = await Transport.compress(
      chunk.payload,
    );

    const envelope: SessionReplayChunkEnvelope = {
      ...chunk.envelope,
      payloadEncoding: compressed.encoding,
      payloadBytes: compressed.bytes.length,
      flushFailures: this.consecutiveFailures,
    };

    const body: PayloadBytes = Transport.buildBody(envelope, compressed.bytes);

    let response: Response | null = null;

    try {
      response = await fetch(this.options.url, {
        method: "POST",
        headers: this.buildHeaders(compressed.encoding),
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

      this.recordRetryableFailure(chunk, isRetry);
      return "halt";
    }

    return await this.handleResponse(response, chunk, envelope, isRetry);
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
    isRetry: boolean,
  ): Promise<PostOutcome> {
    const status: number = response.status;

    if (status >= 200 && status < 300) {
      this.consecutiveFailures = 0;

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
        { status: status, url: this.options.url },
      );

      this.disable(`http-${status}`);
      return "halt";
    }

    /*
     * The chunk itself was rejected: too large, or a snapshot that cannot be
     * accepted. Dropping this one chunk is correct, and it must NOT count
     * against the circuit breaker - the transport is healthy.
     */
    if (status === 413 || status === 422 || status === 400) {
      debugWarn(
        "chunk-refused",
        "The server refused one chunk; recording continues without it.",
        {
          status: status,
          chunkIndex: sent.chunkIndex,
          payloadBytes: sent.payloadBytes,
        },
      );

      this.droppedChunks++;
      return "chunk-rejected";
    }

    if (status === 429) {
      const retryAfterSeconds: number = Transport.parseRetryAfter(response);

      debugWarn(
        "chunk-throttled",
        "Rate limited. Uploads pause and resume on their own.",
        { retryAfterSeconds: retryAfterSeconds },
      );

      this.throttledUntilUnixMs = Date.now() + retryAfterSeconds * 1000;
      this.enqueueForRetry(chunk);

      /*
       * A healthy server asking us to slow down is not a failure. Counting
       * it would self-disable exactly the recorders on the busiest sites.
       */
      return "halt";
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

    this.recordRetryableFailure(chunk, isRetry);

    return "halt";
  }

  private async applyDirective(response: Response): Promise<void> {
    try {
      const text: string = await response.text();

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
      if (!text) {
        this.applyHeaderDirective(response);
        return;
      }

      const body: unknown = JSON.parse(text);

      if (!body || typeof body !== "object") {
        return;
      }

      const raw: Record<string, unknown> = body as Record<string, unknown>;
      const directive: unknown = raw["directive"];
      const reason: string | null = Transport.readReason(raw["reason"]);

      if (
        directive === "stop" ||
        directive === "throttle" ||
        directive === "continue"
      ) {
        if (directive !== "continue") {
          debugWarn(
            "server-directive",
            "The server changed what this recorder should do.",
            { directive: directive, reason: reason || "not-reported" },
          );
        }

        this.options.onDirective(directive, reason);
      }

      const retryAfterSeconds: unknown = raw["retryAfterSeconds"];

      if (
        typeof retryAfterSeconds === "number" &&
        Number.isFinite(retryAfterSeconds) &&
        retryAfterSeconds > 0
      ) {
        this.throttledUntilUnixMs = Date.now() + retryAfterSeconds * 1000;
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

  private recordRetryableFailure(chunk: QueuedChunk, isRetry: boolean): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= SESSION_REPLAY_MAX_FLUSH_FAILURES) {
      this.disable("max-flush-failures");
      return;
    }

    if (!isRetry) {
      this.enqueueForRetry(chunk);
    }
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

  /*
   * Drop everything queued for retry, without sending it.
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

    this.retryQueue = [];

    this.options.onPermanentFailure(reason);
  }

  private buildHeaders(
    encoding: SessionReplayPayloadEncoding,
  ): Record<string, string> {
    const headers: Record<string, string> = { ...this.options.headers };

    headers["Content-Type"] = SESSION_REPLAY_CONTENT_TYPE;

    /*
     * Content-Encoding is only truthful when we actually compressed. Lying
     * here would make the worker hand garbage to gunzip.
     */
    if (encoding === "gzip") {
      headers["Content-Encoding"] = "gzip";
    }

    return headers;
  }

  public static parseRetryAfter(response: Response): number {
    const header: string | null = response.headers
      ? response.headers.get("retry-after")
      : null;

    if (!header) {
      return 30;
    }

    const seconds: number = Number.parseInt(header, 10);

    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds, 300);
    }

    /* Retry-After may also be an HTTP date. */
    const asDate: number = Date.parse(header);

    if (Number.isFinite(asDate)) {
      return Math.max(
        1,
        Math.min(300, Math.round((asDate - Date.now()) / 1000)),
      );
    }

    return 30;
  }
}
