import {
  MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST,
  SESSION_REPLAY_CONTENT_TYPE,
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SESSION_REPLAY_MAX_FLUSH_FAILURES,
  SessionReplayChunkEnvelope,
  SessionReplayDirective,
  SessionReplayPayloadEncoding,
} from "Common/Types/Rum/SessionReplay";

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

  /* Server's instruction to a live recorder, carried on every response. */
  onDirective: (directive: SessionReplayDirective) => void;

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
       */
      void writer.write(raw);
      void writer.close();

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

    for (const chunk of queued) {
      const retried: boolean = await this.post(chunk, false);

      if (!retried) {
        /*
         * Stop draining on the first failure. Continuing would keep firing
         * requests at an endpoint that has just told us it cannot take them.
         */
        break;
      }
    }

    return await this.post({ envelope: envelope, payload: payload }, false);
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

  private async post(chunk: QueuedChunk, isRetry: boolean): Promise<boolean> {
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
      this.recordRetryableFailure(chunk, isRetry);
      return false;
    }

    return await this.handleResponse(response, chunk, isRetry);
  }

  private async handleResponse(
    response: Response,
    chunk: QueuedChunk,
    isRetry: boolean,
  ): Promise<boolean> {
    const status: number = response.status;

    if (status >= 200 && status < 300) {
      this.consecutiveFailures = 0;
      await this.applyDirective(response);
      return true;
    }

    /*
     * Auth is broken or the endpoint does not exist. Retrying cannot fix
     * either, and hammering a customer's network to prove it is worse than
     * going quiet.
     */
    if (status === 401 || status === 403 || status === 404) {
      this.disable(`http-${status}`);
      return false;
    }

    /*
     * The chunk itself was rejected: too large, or a snapshot that cannot be
     * accepted. Dropping this one chunk is correct, and it must NOT count
     * against the circuit breaker - the transport is healthy.
     */
    if (status === 413 || status === 422 || status === 400) {
      this.droppedChunks++;
      return false;
    }

    if (status === 429) {
      const retryAfterSeconds: number = Transport.parseRetryAfter(response);

      this.throttledUntilUnixMs = Date.now() + retryAfterSeconds * 1000;
      this.enqueueForRetry(chunk);

      /*
       * A healthy server asking us to slow down is not a failure. Counting
       * it would self-disable exactly the recorders on the busiest sites.
       */
      return false;
    }

    this.recordRetryableFailure(chunk, isRetry);

    return false;
  }

  private async applyDirective(response: Response): Promise<void> {
    try {
      const text: string = await response.text();

      if (!text) {
        return;
      }

      const body: unknown = JSON.parse(text);

      if (!body || typeof body !== "object") {
        return;
      }

      const raw: Record<string, unknown> = body as Record<string, unknown>;
      const directive: unknown = raw["directive"];

      if (
        directive === "stop" ||
        directive === "throttle" ||
        directive === "continue"
      ) {
        this.options.onDirective(directive);
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

  private disable(reason: string): void {
    if (this.disabled) {
      return;
    }

    this.disabled = true;
    this.disabledReason = reason;
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
