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
import SessionReplayWireEncoding from "Common/Utils/Rum/SessionReplayWireEncoding";
import { debugLog, debugWarn } from "./Debug";
import OfflineStore, { OfflineChunk } from "./OfflineStore";

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
 *
 * And offline mode, which is the same idea applied to the network itself:
 *
 * 7. Losing the connection is not a failure either. Once this transport has
 *    had ANY answer from the chunk endpoint - so the origin, the auth and
 *    CORS are all known to work - a request that never reaches the server
 *    is the network, not the installation: it costs no strike and no
 *    attempt, and the chunk simply waits. The same when the browser itself
 *    says it is offline (navigator.onLine === false), in which case nothing
 *    is even attempted until its `online` event. Before that first answer a
 *    network failure still counts toward the breaker, because that is also
 *    exactly what a content blocker refusing the chunk URL looks like, and
 *    a recorder must not record and queue forever for an endpoint it will
 *    never reach.
 *
 *    While waiting, recording carries on. The queue is bounded by bytes and
 *    count rather than one request's worth, so an outage of an hour loses
 *    nothing on an ordinary page; past the bound the OLDEST chunks go, as
 *    before, and every one lost is counted. When an OfflineStore is given,
 *    everything queued is also written to IndexedDB, so a tab closed while
 *    offline hands its recording to the next page of the application
 *    (restorePersisted) instead of losing it.
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

  /*
   * Offline mode's durable queue (see OfflineStore). Null or absent keeps
   * queued chunks in memory only: the page opted out of offline storage, or
   * the transport is under test.
   */
  offlineStore?: OfflineStore | null;
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

  /*
   * Where the chunk stands with the offline store:
   *
   *   absent     not stored
   *   "writing"  a write was issued and has not completed
   *   "stored"   durably stored, so it is CLAIMED there before it is posted:
   *              another tab may already have taken it (OfflineStore rule 3)
   *   "claimed"  taken out of the store by this tab (restorePersisted). It
   *              is not written back unless it has to wait again, because a
   *              record written back could be claimed - and sent - by the
   *              tab that stored it first.
   */
  stored?: "writing" | "stored" | "claimed";
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

  /*
   * Whether the body had the shape OneUptime writes: a JSON object with a
   * directive, a reason, an error or a message. Every 4xx the ingest
   * endpoint answers carries one. A web application firewall, CDN or proxy
   * in front of it answers with an HTML page or nothing, and the recorder
   * cannot tell that 403 from an origin-allowlist refusal by status alone.
   */
  fromOneUptime: boolean;
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
 * Property 7: the waits after a request that never reached the server, once
 * the endpoint is known to work. Short at first, because most drops are
 * brief (a tunnel, a lift, a wifi hand-over), then settling at five minutes:
 * one small failed request every five minutes costs nothing, and the
 * browser's `online` event, the next page load or a successful request
 * drains the queue early anyway. None of them is a strike.
 */
export const OFFLINE_RETRY_MS: Array<number> = [
  5_000, 15_000, 30_000, 60_000, 120_000, 300_000,
];

/*
 * While the browser reports itself offline nothing is posted at all; the
 * queue re-checks navigator.onLine this often in case its `online` event
 * was missed. A property read, never a request.
 */
export const OFFLINE_POLL_MS: number = 30_000;

/*
 * How much the queue holds while it waits, in chunks and in payload
 * characters. A chunk closes every 15 s (or at 256 KB), so 240 is an hour of
 * a busy page; the character bound is what actually binds on a heavy one,
 * and keeps the recorder's memory on the customer's page to a few MB however
 * long the outage lasts.
 */
export const MAX_QUEUED_CHUNKS: number = 240;
export const MAX_QUEUED_PAYLOAD_CHARS: number = 4 * 1024 * 1024;

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
   * Property 7. Whether the chunk endpoint has ever answered this transport,
   * and how many requests in a row have since failed to reach it.
   */
  private reachedServer: boolean = false;
  private connectivityFailures: number = 0;

  /*
   * Chunks waiting to be posted: after a retryable failure, during a throttle
   * or an outage. Bounded (MAX_QUEUED_CHUNKS, MAX_QUEUED_PAYLOAD_CHARS): a
   * recorder that hoards an unbounded backlog of end-user content in memory
   * is both a memory leak and a privacy problem.
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

  /*
   * Offline, as far as uploading is concerned: the browser says so, or the
   * last request never reached a server that has answered before.
   */
  public isOffline(): boolean {
    return Transport.browserIsOffline() || this.connectivityFailures > 0;
  }

  private static browserIsOffline(): boolean {
    try {
      return navigator.onLine === false;
    } catch {
      return false;
    }
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
   * The envelope line is written by SessionReplayWireEncoding rather than a
   * bare JSON.stringify: with its `%`, `&` and `http/` escaped and a space
   * before its newline, a web application firewall's request-smuggling
   * rule (CRS 921110) cannot read the envelope's URL or trait values plus
   * that newline as an HTTP request line. The parser JSON.parses the same
   * line either way.
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
      SessionReplayWireEncoding.encodeEnvelopeLine(envelope),
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

        if (Transport.browserIsOffline()) {
          debugLog(
            "chunk-held-offline",
            "Browser offline; chunks are kept until it returns.",
            {
              chunkIndex: current.envelope.chunkIndex,
              queueDepth: this.retryQueue.length,
            },
          );
        }

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
   *
   * The SEALING frame itself is never the loss. When the last piece of a
   * final flush cannot fit the quota on its own, its footage is dropped and
   * an EMPTY frame is sent in its place: the same envelope, the same chunk
   * index, payload "[]", with the dropped events added to droppedEvents.
   * Dropping the whole frame, as this used to, meant a tab that was closed
   * sent no request at all: the session never learned it had ended, sat in
   * "Recording now" until the idle finalizer ran, and the sealing index was
   * a hole in the chunk sequence.
   *
   * This is the BACKSTOP. The ordinary oversized seal - one indivisible
   * event bigger than a keepalive request, such as a large DOM insertion
   * right before the tab closed - is emptied by the chunker before any
   * index is minted (Chunker.closeSplit), so the older pieces of the split
   * keep the budget that piece could never use. What still reaches this is
   * a piece that fits the chunker's payload budget but not once its
   * envelope is added. Only a frame whose envelope says isFinal gets a
   * stand-in; a non-final tail (a hidden tab's early flush, the only
   * terminal flush that is not final now that every pagehide seals) seals
   * nothing, so it is dropped and counted as before.
   */
  public sendTerminal(chunks: Array<TerminalChunk>): boolean {
    if (chunks.length === 0) {
      return false;
    }

    if (this.disabled) {
      this.droppedChunks += chunks.length;
      return false;
    }

    const store: OfflineStore | null = this.options.offlineStore || null;
    const pieces: Array<QueuedChunk> = chunks.map(
      (chunk: TerminalChunk): QueuedChunk => {
        return {
          envelope: chunk.envelope,
          payload: chunk.payload,
          attempts: 0,
        };
      },
    );

    /*
     * Offline mode. A keepalive request would fail like any other, and take
     * the page's last chunks with it. With an offline store they are queued
     * instead - and so written to IndexedDB, from inside this handler, with
     * the rest of the queue - for this page to send if it lives on (a tab
     * that was only hidden), or the next page of the application if it does
     * not. Every piece is kept, so nothing about the keepalive quota applies.
     */
    if (store && this.isOffline()) {
      this.releaseClaimed();
      this.enqueueForRetry(...pieces);
      this.scheduleDrain(this.pausedUntilUnixMs());

      debugLog(
        "offline-flush-stored",
        "Offline at page exit; last chunks kept.",
        {
          chunks: pieces.length,
          queueDepth: this.retryQueue.length,
          storeOpen: store.isOpen(),
        },
      );

      return true;
    }

    const queued: Array<QueuedChunk> = this.retryQueue;
    this.retryQueue = [];
    this.cancelDrain();

    /*
     * Sealing frame first, then the rest of the split newest-first, then
     * the retry queue oldest-first. Built in priority order; the body is
     * assembled in chunkIndex order afterwards.
     */
    const candidates: Array<QueuedChunk> = pieces.slice().reverse();

    candidates.push(...queued);

    const selected: Array<{ frame: PayloadBytes; chunkIndex: number }> = [];
    let totalBytes: number = 0;
    let dropped: number = 0;

    /*
     * What the quota could not carry. With an offline store it is kept for
     * the next upload instead of being lost; without one it is dropped.
     */
    const leftovers: Array<QueuedChunk> = [];

    /* Stored chunks that ARE in this request, to forget once it is sent. */
    const sentStored: Array<SessionReplayChunkEnvelope> = [];

    /*
     * Size of the sealing frame as the split built it, for the diagnostics
     * when it is the one that could not fit.
     */
    let sealingBytes: number = 0;

    /*
     * Events whose sealing frame was over the quota and went out as an empty
     * stand-in; null when the sealing frame went out whole (or was not a
     * final one).
     */
    let emptiedSealingEvents: number | null = null;

    for (let index: number = 0; index < candidates.length; index++) {
      const candidate: QueuedChunk = candidates[index]!;
      let frame: PayloadBytes = Transport.buildIdentityFrame(
        candidate.envelope,
        candidate.payload,
      );

      /*
       * Set only for the sealing frame, and only when it is replaced. The
       * stand-in is an envelope and two bytes of payload, and the envelope
       * is held under 8 KB by the server's own rule, so it always fits an
       * empty request - but the diagnostics below are driven by what was
       * actually selected, never by what was merely attempted.
       */
      let standInFor: number | null = null;

      if (index === 0) {
        sealingBytes = frame.length;

        if (
          candidate.envelope.isFinal &&
          frame.length > SESSION_REPLAY_KEEPALIVE_MAX_BYTES
        ) {
          frame = Transport.buildIdentityFrame(
            Transport.buildEmptySealingEnvelope(candidate.envelope),
            "[]",
          );
          standInFor = candidate.envelope.eventCount;
        }
      }

      if (
        totalBytes + frame.length > SESSION_REPLAY_KEEPALIVE_MAX_BYTES ||
        selected.length >= MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST
      ) {
        if (store) {
          leftovers.push(candidate);
        } else {
          dropped++;
        }

        continue;
      }

      if (standInFor !== null) {
        emptiedSealingEvents = standInFor;
      }

      if (candidate.stored === "writing" || candidate.stored === "stored") {
        sentStored.push(candidate.envelope);
      }

      selected.push({
        frame: frame,
        chunkIndex: candidate.envelope.chunkIndex,
      });
      totalBytes += frame.length;
    }

    this.droppedChunks += dropped;

    if (store) {
      store.remove(sentStored);

      for (const leftover of leftovers) {
        if (leftover.stored === "claimed") {
          delete leftover.stored;
        }
      }

      if (leftovers.length > 0) {
        /* Back in chunk order: candidates were in priority order. */
        leftovers.sort((left: QueuedChunk, right: QueuedChunk): number => {
          return left.envelope.chunkIndex - right.envelope.chunkIndex;
        });

        this.enqueueForRetry(...leftovers);
        this.scheduleDrain(this.pausedUntilUnixMs());

        debugLog(
          "final-flush-deferred",
          "Keepalive quota full; the rest were kept.",
          { sent: selected.length, kept: leftovers.length },
        );
      }
    }

    /*
     * The same code for both outcomes, because the loss it reports is the
     * same kind - the footage of the last piece a page-exit flush tried to
     * send - and the detail says which one happened: `sealed` is true when
     * an empty final frame still went out in its place (the session is
     * sealed and the index is not a hole), false when the tail was a
     * non-final one and was dropped whole.
     *
     * The `sealed: false` message says exactly what that is now. Every
     * pagehide seals, and a final tail always sends at least its stand-in,
     * so nothing is selected only when a NON-final tail - the keepalive
     * flush of a tab that was hidden - could not fit (its payload fits the
     * budget, so its envelope pushed it over). The tab did not close: the
     * session stays open, and the lost events are a gap in the middle of
     * the recording, not a recording that ends early.
     */
    if (emptiedSealingEvents !== null) {
      debugWarn(
        "final-chunk-too-large",
        "The final chunk was over the keepalive quota; its events were dropped and an empty final chunk sealed the session in its place.",
        {
          bytes: sealingBytes,
          maxBytes: SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
          droppedEvents: emptiedSealingEvents,
          droppedChunks: dropped,
          sealed: true,
        },
      );
    }

    if (selected.length === 0) {
      debugWarn(
        "final-chunk-too-large",
        "A non-final chunk sent as the tab was hidden was over the keepalive quota and was dropped; the session stays open with a gap.",
        {
          bytes: sealingBytes,
          maxBytes: SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
          droppedChunks: dropped,
          sealed: false,
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

  /*
   * The envelope of the empty frame that seals a session in place of a
   * final piece too large for the keepalive quota.
   *
   * Everything that makes it the SEALING frame is kept: the chunk index (so
   * the sequence has no hole), isFinal, the meta the header is built from,
   * the per-chunk signals, trace ids and routes the finalizer sums and
   * unions, the fidelity notices. What changes is only what describes the
   * footage it no longer carries:
   *
   *   eventCount       0, and those events are added to droppedEvents, the
   *                    same disclosure every other drop path uses.
   *   hasFullSnapshot  false: an empty chunk is no seek anchor.
   *   offsets          both collapse to the END of the dropped piece. An
   *                    empty chunk claims no span of footage, so the player
   *                    does not draw one it cannot play; the end is kept
   *                    because it is when the recording really stopped,
   *                    which keeps the session's duration and is what the
   *                    server's "has this tab ended" rule compares later
   *                    chunks against. It is never earlier than the piece's
   *                    own start, which is never earlier than the previous
   *                    chunk's end, so start <= end and the sequence stays
   *                    monotonic.
   */
  public static buildEmptySealingEnvelope(
    envelope: SessionReplayChunkEnvelope,
  ): SessionReplayChunkEnvelope {
    const endOffsetMs: number = Math.max(
      envelope.chunkStartOffsetMs,
      envelope.chunkEndOffsetMs,
    );

    const sealing: SessionReplayChunkEnvelope = {
      ...envelope,
      chunkStartOffsetMs: endOffsetMs,
      chunkEndOffsetMs: endOffsetMs,
      eventCount: 0,
      hasFullSnapshot: false,
      droppedEvents: envelope.droppedEvents + envelope.eventCount,
    };

    return sealing;
  }

  private static buildIdentityFrame(
    envelope: SessionReplayChunkEnvelope,
    payload: string,
  ): PayloadBytes {
    const payloadBytes: PayloadBytes = new TextEncoder().encode(payload);

    return Transport.buildBody(
      {
        ...envelope,
        /* Sent now, however long it waited: see postOnce. */
        clientSendUnixMs: Date.now(),
        payloadEncoding: "identity",
        payloadBytes: payloadBytes.length,
      },
      payloadBytes,
    );
  }

  /*
   * One chunk, one request - bracketed by the offline store. A chunk that is
   * durably stored is claimed first, and skipped when another tab already
   * took it (OfflineStore, rule 3); a chunk that is done with - accepted, or
   * refused for good - is forgotten there afterwards. A chunk that is
   * waiting again was put back by enqueueForRetry.
   */
  private async post(chunk: QueuedChunk): Promise<PostOutcome> {
    const store: OfflineStore | null = this.options.offlineStore || null;
    const stored: QueuedChunk["stored"] = chunk.stored;

    /*
     * Whatever it was, the attempt starts from "not stored": a chunk that has
     * to wait again is written back by enqueueForRetry.
     */
    delete chunk.stored;

    if (store && stored === "stored") {
      if (!(await store.claim(chunk.envelope))) {
        debugLog(
          "offline-chunk-claimed-elsewhere",
          "Another tab took this stored chunk.",
          { chunkIndex: chunk.envelope.chunkIndex },
        );

        return "accepted";
      }
    }

    const outcome: PostOutcome = await this.postOnce(chunk);

    if (store && outcome !== "halt") {
      store.remove([chunk.envelope]);
    }

    return outcome;
  }

  private async postOnce(chunk: QueuedChunk): Promise<PostOutcome> {
    const compressed: CompressionResult = await Transport.compress(
      chunk.payload,
    );

    /*
     * clientSendUnixMs is stamped HERE, as the request goes out, not when
     * the chunk closed: a chunk that waited out an outage says how long it
     * waited, which is what lets the server keep a recording uploaded hours
     * later on its real timeline (SessionIdentity.getClientQueueDelayMs).
     */
    const envelope: SessionReplayChunkEnvelope = {
      ...chunk.envelope,
      clientSendUnixMs: Date.now(),
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
      /*
       * The request never reached a server. Offline (property 7) when the
       * browser says so or the endpoint has answered before; otherwise it
       * is retryable and counts against the breaker, because it may just as
       * well be a content blocker that will refuse this URL forever.
       */
      if (Transport.browserIsOffline() || this.reachedServer) {
        this.recordConnectivityFailure(chunk);
        return "halt";
      }

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

    /* Any answer at all: the network is back, and the endpoint is real. */
    this.reachedServer = true;

    if (this.connectivityFailures > 0) {
      debugLog("back-online", "Back online; uploading resumes.", {
        queueDepth: this.retryQueue.length,
      });

      this.connectivityFailures = 0;
      this.backoffUntilUnixMs = 0;
    }

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
       *
       * answeredBy separates two very different fixes behind the same
       * status. A 403 from OneUptime is an allowlist to edit; a 403 with no
       * OneUptime body came from something in front of it - most often a
       * web application firewall - and the fix is on that device.
       */
      debugWarn(
        "chunk-rejected-terminal",
        said.fromOneUptime
          ? "Uploading stopped for good: the server refused this recorder."
          : "Uploading stopped for good: the refusal did not come from OneUptime. A web application firewall, CDN or proxy in front of it, or a host that is not OneUptime, answered.",
        {
          status: status,
          url: this.options.url,
          reason: said.reason || said.error || "not-reported",
          answeredBy: said.fromOneUptime ? "oneuptime" : "not-oneuptime",
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
      fromOneUptime: false,
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
        fromOneUptime:
          "directive" in raw ||
          "reason" in raw ||
          "error" in raw ||
          "message" in raw,
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
      this.options.offlineStore?.remove([chunk.envelope]);
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

  /*
   * Property 7: the request never reached the server, and that is the
   * network rather than the installation. No strike, no attempt against the
   * chunk - it waits, as long as it takes, for the connection to return.
   */
  private recordConnectivityFailure(chunk: QueuedChunk): void {
    this.connectivityFailures++;

    const waitMs: number =
      OFFLINE_RETRY_MS[
        Math.min(this.connectivityFailures, OFFLINE_RETRY_MS.length) - 1
      ]!;

    this.backoffUntilUnixMs = Date.now() + waitMs;
    this.enqueueForRetry(chunk);

    debugWarn(
      "chunk-held-offline",
      "No connection; chunks are kept until it returns.",
      {
        chunkIndex: chunk.envelope.chunkIndex,
        queueDepth: this.retryQueue.length,
        retryInMs: waitMs,
        browserOffline: Transport.browserIsOffline(),
      },
    );

    this.scheduleDrain(this.pausedUntilUnixMs());
  }

  /*
   * Queue chunks to be posted later, in the order given, behind whatever is
   * already waiting, then write the ones not yet stored to the offline store
   * in ONE transaction (which is what a pagehide handler needs).
   */
  private enqueueForRetry(...chunks: Array<QueuedChunk>): void {
    this.retryQueue.push(...chunks);

    let queuedChars: number = 0;

    for (const queued of this.retryQueue) {
      queuedChars += queued.payload.length;
    }

    const dropped: Array<SessionReplayChunkEnvelope> = [];

    /*
     * Over a bound: drop the OLDEST queued chunk. The most recent seconds
     * are the ones closest to whatever went wrong, so they are the ones worth
     * keeping - and a later full snapshot re-anchors the player after a gap.
     * The newest chunk is always kept, however large.
     */
    while (
      this.retryQueue.length > 1 &&
      (this.retryQueue.length > MAX_QUEUED_CHUNKS ||
        queuedChars > MAX_QUEUED_PAYLOAD_CHARS)
    ) {
      const oldest: QueuedChunk = this.retryQueue.shift()!;

      queuedChars -= oldest.payload.length;
      dropped.push(oldest.envelope);
      this.droppedChunks++;
    }

    const store: OfflineStore | null = this.options.offlineStore || null;

    if (!store) {
      return;
    }

    if (dropped.length > 0) {
      debugWarn(
        "offline-queue-full",
        "Upload queue full; oldest chunks dropped.",
        { dropped: dropped.length, queueDepth: this.retryQueue.length },
      );

      store.remove(dropped);
    }

    const unstored: Array<QueuedChunk> = this.retryQueue.filter(
      (queued: QueuedChunk): boolean => {
        return !queued.stored;
      },
    );

    for (const queued of unstored) {
      queued.stored = "writing";
    }

    store.put(unstored, (): void => {
      for (const queued of unstored) {
        /* Not if an upload attempt started meanwhile: see post(). */
        if (queued.stored === "writing") {
          queued.stored = "stored";
        }
      }
    });
  }

  /*
   * The page is going away: whatever this tab claimed from the offline
   * store and has not yet sent must be written back, or it goes with the
   * page.
   */
  private releaseClaimed(): void {
    for (const queued of this.retryQueue) {
      if (queued.stored === "claimed") {
        delete queued.stored;
      }
    }
  }

  /*
   * The page is loading, and an earlier page of this application - closed,
   * reloaded or navigated away from while offline - left chunks in the
   * offline store. Claim them and upload them ahead of anything this page
   * records. Called only once uploading is allowed (consent), and cheap
   * when there is nothing to do: the store is not even opened unless a page
   * said it left something.
   */
  public async restorePersisted(): Promise<number> {
    const store: OfflineStore | null = this.options.offlineStore || null;

    if (!store || this.disabled || !OfflineStore.hasPending()) {
      return 0;
    }

    const restored: Array<OfflineChunk> = await store.takeAll();

    if (restored.length === 0 || this.disabled) {
      return 0;
    }

    debugLog(
      "offline-chunks-restored",
      "Uploading chunks an earlier page kept offline.",
      { chunks: restored.length },
    );

    /* Ahead of this page's own queue: they were recorded first. */
    const ownQueue: Array<QueuedChunk> = this.retryQueue;

    this.retryQueue = [];
    this.enqueueForRetry(
      ...restored.map((chunk: OfflineChunk): QueuedChunk => {
        return {
          envelope: chunk.envelope,
          payload: chunk.payload,
          attempts: 0,
          stored: "claimed",
        };
      }),
      ...ownQueue,
    );

    this.resume();

    return restored.length;
  }

  /*
   * The browser says the connection is back (its `online` event). An
   * offline wait ends now; a server throttle and a failure backoff do not.
   */
  public resume(): void {
    if (this.connectivityFailures > 0) {
      this.backoffUntilUnixMs = 0;
    }

    if (this.disabled || this.retryQueue.length === 0) {
      return;
    }

    if (this.isPaused()) {
      this.scheduleDrain(this.pausedUntilUnixMs());
      return;
    }

    this.cancelDrain();
    this.drainLater();
  }

  /*
   * The browser says the connection is gone (its `offline` event). Open the
   * offline store now, while the page is alive: a pagehide handler can only
   * write to a database that is already open.
   */
  public prepareForOffline(): void {
    if (this.options.offlineStore && !this.disabled) {
      void this.options.offlineStore.open();
    }
  }

  private isPaused(nowUnixMs: number = Date.now()): boolean {
    return (
      this.isThrottled(nowUnixMs) ||
      this.isBackingOff(nowUnixMs) ||
      Transport.browserIsOffline()
    );
  }

  private pausedUntilUnixMs(): number {
    return Math.max(
      this.throttledUntilUnixMs,
      this.backoffUntilUnixMs,
      Transport.browserIsOffline() ? Date.now() + OFFLINE_POLL_MS : 0,
    );
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

    /*
     * And what an earlier page left in the offline store: it is held under
     * the same consent, and nothing will upload it either.
     */
    this.options.offlineStore?.clear();
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
    this.options.offlineStore?.clear();

    this.options.onPermanentFailure(reason);
  }

  /*
   * No Content-Encoding header, ever. The body is `<envelope JSON>\n<payload>`
   * and only the PAYLOAD is gzipped, so "Content-Encoding: gzip" would
   * describe a body that is not gzip. The server never read the header (the
   * envelope's payloadEncoding is what its parser branches on), but any
   * proxy, CDN or WAF between the page and the server that honours it would
   * try to inflate the envelope line and reject or corrupt every chunk.
   *
   * The Content-Type is application/octet-stream for the same audience: a
   * WAF on the OWASP Core Rule Set refuses a vendor media type outright
   * (rule 920420), while octet-stream is on its allowlist and is never
   * parsed into ARGS. See SESSION_REPLAY_CONTENT_TYPE.
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
