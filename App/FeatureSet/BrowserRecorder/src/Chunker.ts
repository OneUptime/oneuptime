import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_FLUSH_BYTES,
  SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES,
  SessionReplayFidelityNotice,
  SessionReplaySignalCounts,
} from "Common/Types/Rum/SessionReplay";
import { BufferedEvent } from "./RollingBuffer";

/*
 * Cuts the event stream into chunks.
 *
 * A chunk closes on whichever comes first: rrweb reporting isCheckout, the
 * pre-compression byte threshold, the recorder's flush timer, or a terminal
 * page transition.
 *
 * The isCheckout rule is the important one, and it is why this class exists
 * instead of a timer. checkoutEveryNms and the flush interval are two
 * independent timers; setting both to the same number does NOT make a
 * snapshot land on a chunk boundary. Reading rrweb's second emit argument
 * does, exactly, and that is what makes hasFullSnapshot a fact rather than a
 * guess - and therefore what makes seeking land on a DOM the user really
 * saw.
 */

/* rrweb EventType values this module needs to recognise. */
const EVENT_TYPE_DOM_CONTENT_LOADED: number = 0;
const EVENT_TYPE_LOAD: number = 1;
const EVENT_TYPE_FULL_SNAPSHOT: number = 2;
const EVENT_TYPE_META: number = 4;

/*
 * Events that carry nothing replayable. rrweb emits DomContentLoaded (0) and
 * Load (1) when the recorder starts on a page that is still parsing, BEFORE
 * the deferred first snapshot; the player ignores both. Treating them as
 * content made the snapshot that followed them "mid-chunk" and cost chunk 0
 * its hasFullSnapshot flag on every slow-loading page.
 */
function isLifecycleEvent(type: number): boolean {
  return type === EVENT_TYPE_DOM_CONTENT_LOADED || type === EVENT_TYPE_LOAD;
}

/*
 * Per-chunk caps on recorded URLs, by COUNT and by BYTES.
 *
 * The byte budget is the load-bearing one. The routes array rides the
 * envelope JSON, and the server rejects any envelope over 8 KB outright -
 * failing the WHOLE request, up to eight frames, which the transport
 * classifies as a permanent rejection and never retries. A count-only cap
 * cannot prevent that: 32 long URLs are more than 8 KB on their own, so a
 * site with deep paths would silently lose its footage rather than lose a
 * few route entries.
 *
 * 2 KB of routes plus 2 KB of trace ids leaves the rest of the envelope
 * (ids, versions, signals, fidelity notices, and the meta that carries up to
 * 3.3 KB of tags and 4.9 KB of traits) room inside the 8 KB ceiling only
 * because the recorder ALSO measures the finished envelope and sheds
 * optional fields that do not fit - see Recorder.fitEnvelope. A chunk covers
 * ~15s, so a page doing more DISTINCT navigations than these caps allow is
 * rewriting its URL programmatically rather than being navigated by a
 * person; routeCount still counts every change past them.
 */
const MAX_ROUTES_PER_CHUNK: number = 32;
const MAX_ROUTE_BYTES_PER_CHUNK: number = 2 * 1024;

/*
 * Per-chunk caps on trace ids, by COUNT and by BYTES, for the same reason.
 *
 * The count matches the ingest parser's own MAX_TRACE_IDS, so a legitimate
 * chunk is never truncated on the way in. Uncapped, this Set grew for the
 * whole record-into-memory period - a page with OpenTelemetry fetch
 * instrumentation polling every few seconds reaches ~210 distinct ids long
 * before an error fires under the default OnErrorOrFrustration policy, and
 * 235 ids alone are 9.1 KB of envelope: chunk 0, the one carrying the
 * opening snapshot and the capabilities, was refused with a 400 and the
 * session was never listed at all.
 */
const MAX_TRACE_IDS_PER_CHUNK: number = 64;
const MAX_TRACE_ID_BYTES_PER_CHUNK: number = 2 * 1024;

/*
 * Disclosed on the last chunk of a session that hit the per-session chunk
 * cap. Not (yet) a member of Common's SessionReplayFidelityNotice: adding one
 * there is a shared-type change, and a recorder must be able to tell the
 * truth about a session it truncated without waiting for it. The viewer
 * renders unknown notices as-is, so this degrades to a visible, honest string
 * rather than to silence.
 */
export const SESSION_REPLAY_TRUNCATED_NOTICE: string = "truncated";

/*
 * UTF-8 byte length, without allocating the encoded copy.
 *
 * Everything in this file used to count String.length, which is UTF-16 code
 * UNITS. The wire, the 2 MiB request cap and the keepalive quota are all
 * counted in UTF-8 BYTES, so a page in Japanese or one with emoji in its
 * content produced nominal 256 KB chunks that were up to 3x that on the wire
 * and were rejected with a 413 the recorder could only report as a dropped
 * chunk.
 */
export function utf8ByteLength(value: string): number {
  let bytes: number = 0;

  for (let i: number = 0; i < value.length; i++) {
    const code: number = value.charCodeAt(i);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next: number = value.charCodeAt(i + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        /* A well-formed surrogate pair is one 4-byte code point. */
        bytes += 4;
        i++;
        continue;
      }

      /* A lone surrogate encodes as the 3-byte replacement character. */
      bytes += 3;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export interface PendingChunk {
  /*
   * The chunk body before compression: always a COMPLETE JSON array of rrweb
   * events, so a chunk can be decoded on its own.
   *
   * It used to be allowed to be a raw fragment of that array's text, for the
   * one case of an oversized indivisible snapshot, on the understanding that
   * the receiving side would concatenate the parts by chunkIndex before
   * parsing. Nothing ever did — see emitOversizedEvent.
   */
  payload: string;

  rawBytes: number;
  eventCount: number;

  chunkStartOffsetMs: number;
  chunkEndOffsetMs: number;

  hasFullSnapshot: boolean;
  isFinal: boolean;

  signals: SessionReplaySignalCounts;
  fidelityNotices: Array<string>;
  traceIds: Array<string>;

  /*
   * Scrubbed URLs the page was on while this chunk was open, in first-seen
   * order. routeCount already says HOW MANY route changes happened; this
   * says WHICH pages, which is what the session header's routes[] column and
   * the "sessions that hit /checkout" filter are built on. Without it the
   * server can only see the URL the chunk was flushed from, so two
   * navigations inside one flush window collapse to one.
   *
   * The order is meaningful only within a chunk, and nothing downstream
   * depends on it: the session header's routes[] is a de-duplicated SET
   * across every chunk and every tab, sorted for determinism, and the
   * envelope's scalar `url` is what carries "where was this chunk flushed
   * from" - which is how the finalizer resolves the exit page.
   */
  routes: Array<string>;
}

export type ChunkSink = (chunk: PendingChunk) => void;

interface OpenChunk {
  /*
   * The buffered events themselves rather than their JSON alone: closeSplit
   * needs each event's byte size and timestamp to cut the chunk into
   * keepalive-sized pieces, and the objects already exist, so holding the
   * references costs nothing extra.
   */
  events: Array<BufferedEvent>;
  bytes: number;
  eventCount: number;
  startTimestampMs: number;
  endTimestampMs: number;
  hasFullSnapshot: boolean;

  /*
   * Whether anything other than a Meta or FullSnapshot event has landed in
   * this chunk yet. Drives two decisions: a checkout must not close a chunk
   * it has only just opened (rrweb emits Meta and FullSnapshot as two
   * separate isCheckout=true events), and a FullSnapshot only makes a valid
   * seek anchor when nothing replayable precedes it.
   */
  sawContentEvent: boolean;
}

export default class Chunker {
  private readonly sessionStartUnixMs: number;
  private readonly sink: ChunkSink;
  private readonly maxPayloadBytes: number;

  /*
   * Called once, when the session chunk cap is first hit. The recorder uses
   * it to stop rrweb: past this point the page is paying to record events
   * that will never be sent and nobody will ever watch.
   */
  private readonly onTruncated: (() => void) | null;

  private open: OpenChunk | null = null;
  private closedChunkCount: number = 0;
  private truncationEmitted: boolean = false;
  private droppedEvents: number = 0;

  private signals: SessionReplaySignalCounts = Chunker.emptySignals();
  private readonly fidelityNotices: Set<string> = new Set<string>();
  private traceIds: Set<string> = new Set<string>();

  /* Running UTF-8 size of `traceIds`, for the envelope byte budget. */
  private traceIdBytes: number = 0;

  /*
   * A Set for de-duplication, but iteration order is insertion order, so the
   * emitted array is chronological - which is what makes the last element
   * usable as the chunk's exit URL.
   */
  private routes: Set<string> = new Set<string>();

  /* Running UTF-8 size of `routes`, for the envelope byte budget. */
  private routeBytes: number = 0;

  public constructor(options: {
    sessionStartUnixMs: number;
    sink: ChunkSink;
    maxPayloadBytes?: number;
    onTruncated?: () => void;
  }) {
    this.sessionStartUnixMs = options.sessionStartUnixMs;
    this.sink = options.sink;
    this.maxPayloadBytes =
      options.maxPayloadBytes === undefined
        ? SESSION_REPLAY_FLUSH_BYTES
        : options.maxPayloadBytes;
    this.onTruncated =
      options.onTruncated === undefined ? null : options.onTruncated;
  }

  public static emptySignals(): SessionReplaySignalCounts {
    return {
      errorCount: 0,
      rageClickCount: 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      routeCount: 0,

      /*
       * Sent as explicit zeros rather than omitted: this recorder DOES
       * measure both, so 0 is a measurement, and the server reads absence
       * as 0 anyway - the only difference is that an envelope from this
       * build says so.
       */
      clickCount: 0,
      customEventCount: 0,
    };
  }

  public add(event: BufferedEvent): void {
    if (this.hasReachedSessionChunkCap()) {
      this.droppedEvents++;
      this.emitTruncationChunk();
      return;
    }

    if (event.isCheckout && this.open !== null && this.open.sawContentEvent) {
      this.close(false);
    }

    /*
     * A FullSnapshot is ONE indivisible rrweb event: it cannot be cut in half
     * and still parse. On a large DOM it can exceed the flush threshold on its
     * own, so it gets a chunk to ITSELF, over the threshold. The threshold is
     * a flush cadence, not a wire limit — the wire limits are
     * MAX_SESSION_REPLAY_CHUNK_BYTES post-compression and
     * SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES raw, and the recorder gzips.
     */
    if (event.bytes + 2 > this.maxPayloadBytes) {
      this.close(false);
      this.emitOversizedEvent(event);
      return;
    }

    if (this.open === null) {
      this.open = {
        events: [],
        bytes: 0,
        eventCount: 0,
        startTimestampMs: event.timestampMs,
        endTimestampMs: event.timestampMs,
        hasFullSnapshot: false,
        sawContentEvent: false,
      };
    }

    if (event.type === EVENT_TYPE_FULL_SNAPSHOT && !this.open.sawContentEvent) {
      this.open.hasFullSnapshot = true;
    }

    if (
      event.type !== EVENT_TYPE_META &&
      event.type !== EVENT_TYPE_FULL_SNAPSHOT &&
      !isLifecycleEvent(event.type)
    ) {
      this.open.sawContentEvent = true;
    }

    this.open.events.push(event);
    this.open.bytes += event.bytes;
    this.open.eventCount++;
    this.open.endTimestampMs = event.timestampMs;

    if (this.open.bytes >= this.maxPayloadBytes) {
      this.close(false);
    }
  }

  public addMany(events: Array<BufferedEvent>): void {
    for (const event of events) {
      this.add(event);
    }
  }

  /*
   * Close the open chunk and hand it to the sink.
   *
   * isFinal is emitted even with nothing buffered, because the server needs
   * to know a session ended cleanly rather than inferring it from ten
   * minutes of silence - the difference between sealedReason "final-chunk"
   * and "idle-timeout".
   */
  public close(isFinal: boolean): void {
    const open: OpenChunk | null = this.open;

    this.open = null;

    /*
     * Checked BEFORE the empty-chunk branch. Both paths used to return
     * silently at the cap: events were discarded, droppedEvents was not
     * incremented, no notice was raised and no final chunk was ever sent, so
     * the server sealed the session as idle-timeout and the viewer was shown
     * a recording that simply stops with no disclosure.
     */
    if (this.hasReachedSessionChunkCap()) {
      this.droppedEvents += open ? open.eventCount : 0;
      this.emitTruncationChunk();
      return;
    }

    if (!open || open.eventCount === 0) {
      if (isFinal) {
        this.emitEmptyFinalChunk();
      }
      return;
    }

    this.closedChunkCount++;

    this.sink({
      payload: Chunker.joinPayload(open.events),
      rawBytes: open.bytes,
      eventCount: open.eventCount,
      chunkStartOffsetMs: this.getOffset(open.startTimestampMs),
      chunkEndOffsetMs: this.getOffset(open.endTimestampMs),
      hasFullSnapshot: open.hasFullSnapshot,
      isFinal: isFinal,
      signals: this.signals,
      fidelityNotices: Array.from(this.fidelityNotices),
      traceIds: Array.from(this.traceIds),
      routes: Array.from(this.routes),
    });

    this.resetPerChunkCounters();
  }

  /*
   * Close the open chunk as a SERIES of chunks, none larger than
   * maxPayloadBytes, with contiguous indexes and the final flag on the last.
   *
   * Exists for the pagehide path. A terminal flush goes out with
   * fetch(keepalive), which browsers cap at 64 KB in flight, while the
   * normal flush threshold is 256 KB - so a single close() at pagehide
   * handed the transport a body it had to drop whole, and the last thing
   * the user did before leaving was exactly the footage that vanished. Cut
   * into keepalive-sized pieces, each piece is a complete JSON array that
   * decodes on its own; whatever the browser's quota still admits arrives,
   * and what does not is COUNTED by the transport rather than lost silently.
   *
   * An event that is on its own larger than the cap gets a piece to itself:
   * it cannot be split and still parse, and dropping it here would only
   * move the silent loss one layer down. The per-chunk counters, trace ids
   * and routes ride the LAST piece - the finalizer sums and unions them
   * across chunks, so carrying them on one piece keeps every total right.
   *
   * maxTotalBytes bounds what the WHOLE split may weigh, because the
   * keepalive quota the pieces are cut for is counted per origin across
   * every in-flight request: three 48 KB pieces are not three requests that
   * fit, they are one request that fits and two the browser rejects. Past
   * it the OLDEST pieces are dropped - the footage closest to the moment the
   * user left is the footage the session was captured for - and their events
   * are counted in droppedEvents, which rides the envelope. Cutting them
   * here rather than in the transport is what keeps the chunk sequence
   * contiguous: an index minted for a request that is never issued is a
   * hole the player reports as a missing chunk forever.
   */
  public closeSplit(
    isFinal: boolean,
    maxPayloadBytes: number,
    maxTotalBytes?: number,
  ): void {
    const open: OpenChunk | null = this.open;

    this.open = null;

    if (this.hasReachedSessionChunkCap()) {
      this.droppedEvents += open ? open.eventCount : 0;
      this.emitTruncationChunk();
      return;
    }

    if (!open || open.eventCount === 0) {
      if (isFinal) {
        this.emitEmptyFinalChunk();
      }
      return;
    }

    const pieces: Array<Array<BufferedEvent>> = [];
    let current: Array<BufferedEvent> = [];
    let currentBytes: number = 0;

    for (const event of open.events) {
      /* +2 for the surrounding brackets, +1 per separating comma. */
      const projected: number = currentBytes + event.bytes + current.length + 2;

      if (current.length > 0 && projected > maxPayloadBytes) {
        pieces.push(current);
        current = [];
        currentBytes = 0;
      }

      current.push(event);
      currentBytes += event.bytes;
    }

    if (current.length > 0) {
      pieces.push(current);
    }

    /* Pieces dropped off the FRONT for the total budget; see below. */
    let droppedPieces: number = 0;

    if (maxTotalBytes !== undefined) {
      let budget: number = maxTotalBytes;
      let keepFrom: number = pieces.length;

      for (let index: number = pieces.length - 1; index >= 0; index--) {
        const piece: Array<BufferedEvent> = pieces[
          index
        ] as Array<BufferedEvent>;

        let bytes: number = piece.length + 1;

        for (const event of piece) {
          bytes += event.bytes;
        }

        if (bytes > budget) {
          break;
        }

        budget -= bytes;
        keepFrom = index;
      }

      /*
       * The newest piece is kept even when it alone is over budget: it is
       * the one carrying isFinal and the per-chunk counters, and the
       * transport still refuses anything genuinely too large to post.
       */
      if (keepFrom >= pieces.length) {
        keepFrom = pieces.length - 1;
      }

      for (let index: number = 0; index < keepFrom; index++) {
        this.droppedEvents += (pieces[index] as Array<BufferedEvent>).length;
      }

      droppedPieces = keepFrom;
      pieces.splice(0, keepFrom);
    }

    for (let index: number = 0; index < pieces.length; index++) {
      const piece: Array<BufferedEvent> = pieces[index] as Array<BufferedEvent>;
      const isLast: boolean = index === pieces.length - 1;

      if (this.hasReachedSessionChunkCap()) {
        this.droppedEvents += piece.length;
        this.emitTruncationChunk();
        continue;
      }

      const first: BufferedEvent = piece[0] as BufferedEvent;
      const last: BufferedEvent = piece[piece.length - 1] as BufferedEvent;

      let bytes: number = 0;

      for (const event of piece) {
        bytes += event.bytes;
      }

      this.closedChunkCount++;

      this.sink({
        payload: Chunker.joinPayload(piece),
        rawBytes: bytes,
        eventCount: piece.length,
        chunkStartOffsetMs: this.getOffset(first.timestampMs),
        chunkEndOffsetMs: this.getOffset(last.timestampMs),

        /*
         * Only the chunk's OWN first piece can open on its snapshot; any
         * later piece starts wherever the byte cap happened to fall, which
         * is never a seek anchor - and neither is the first SURVIVING piece
         * when the ones in front of it were dropped for the total budget.
         */
        hasFullSnapshot:
          index === 0 && droppedPieces === 0 ? open.hasFullSnapshot : false,
        isFinal: isFinal && isLast,
        signals: isLast ? this.signals : Chunker.emptySignals(),
        fidelityNotices: Array.from(this.fidelityNotices),
        traceIds: isLast ? Array.from(this.traceIds) : [],
        routes: isLast ? Array.from(this.routes) : [],
      });
    }

    this.resetPerChunkCounters();
  }

  private static joinPayload(events: Array<BufferedEvent>): string {
    let payload: string = "[";

    for (let index: number = 0; index < events.length; index++) {
      if (index > 0) {
        payload += ",";
      }

      payload += (events[index] as BufferedEvent).json;
    }

    return `${payload}]`;
  }

  /*
   * Does the chunk currently open begin on a full snapshot? The recorder
   * asks before flushing the pre-roll: a chunk 0 cut before rrweb's deferred
   * first snapshot has arrived would not be a seek anchor, and the whole
   * value of chunk 0 is that it always is one.
   */
  public hasOpenFullSnapshot(): boolean {
    return this.open !== null && this.open.hasFullSnapshot;
  }

  private emitEmptyFinalChunk(): void {
    const nowOffsetMs: number = this.getOffset(Date.now());

    this.closedChunkCount++;

    this.sink({
      payload: "[]",
      rawBytes: 0,
      eventCount: 0,
      chunkStartOffsetMs: nowOffsetMs,
      chunkEndOffsetMs: nowOffsetMs,
      hasFullSnapshot: false,
      isFinal: true,
      signals: this.signals,
      fidelityNotices: Array.from(this.fidelityNotices),
      traceIds: Array.from(this.traceIds),
      routes: Array.from(this.routes),
    });

    this.resetPerChunkCounters();
  }

  /*
   * Emit one indivisible event that is bigger than the flush threshold, whole,
   * in a chunk of its own.
   *
   * This used to CUT the event into `maxPayloadBytes` slices of raw array
   * text, tagged with snapshotPart {index, total}, on the stated
   * understanding that "the receiving side must concatenate the parts by
   * chunkIndex before parsing". Nothing on the receiving side ever did.
   * SessionReplayIngestService.decodePayload JSON.parses every frame on its
   * own, so each part threw and was dropped as an undecodable payload — and
   * because the recorder had already minted a chunk index for each one, the
   * indexes stayed missing forever. The dashboard reported them honestly ("8
   * chunks missing", gaps on the scrubber) and the recording lost precisely
   * the FullSnapshot it needed to be replayable, on every page whose DOM
   * serialises to more than the flush threshold. Splitting could not be
   * repaired in the recorder alone either: the parts arrive in separate
   * requests, and a fragment cannot be scrubbed, so the server could not
   * safely store one even if it did reassemble them.
   *
   * So: no fragments. A complete chunk over the flush threshold costs one
   * larger POST and is decodable on its own. Past the ceiling the worker will
   * actually inflate, the event is dropped WITH a disclosure — a snapshot the
   * viewer is told about is strictly better than a hole nothing reports.
   */
  private emitOversizedEvent(event: BufferedEvent): void {
    if (this.hasReachedSessionChunkCap()) {
      this.droppedEvents++;
      this.emitTruncationChunk();
      return;
    }

    const payload: string = `[${event.json}]`;
    const rawBytes: number = utf8ByteLength(payload);

    if (rawBytes > SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES) {
      /*
       * No chunk index is minted here: add() has not called the sink, so the
       * sequence stays contiguous and the session simply has one fewer seek
       * anchor. The notice rides the next chunk that closes.
       */
      this.droppedEvents++;
      this.addFidelityNotice(SessionReplayFidelityNotice.SnapshotTooLarge);
      return;
    }

    const offsetMs: number = this.getOffset(event.timestampMs);

    this.closedChunkCount++;

    this.sink({
      payload: payload,
      rawBytes: rawBytes,
      eventCount: 1,
      chunkStartOffsetMs: offsetMs,
      chunkEndOffsetMs: offsetMs,

      /*
       * The event is alone in this chunk, so nothing replayable precedes the
       * snapshot and it is a valid seek anchor - the property the old
       * last-part-only rule was reaching for.
       */
      hasFullSnapshot: event.type === EVENT_TYPE_FULL_SNAPSHOT,
      isFinal: false,
      signals: this.signals,
      fidelityNotices: Array.from(this.fidelityNotices),
      traceIds: Array.from(this.traceIds),
      routes: Array.from(this.routes),
    });

    this.resetPerChunkCounters();
  }

  /*
   * The one chunk a truncated session is still allowed to send.
   *
   * Emitted past the cap on purpose: it carries no page content (payload
   * "[]"), and it is the only thing that turns a session that just stops into
   * one the viewer is told was cut short. isFinal seals it as final-chunk
   * rather than leaving the server to infer idle-timeout ten minutes later.
   */
  private emitTruncationChunk(): void {
    if (this.truncationEmitted) {
      return;
    }

    this.truncationEmitted = true;

    this.fidelityNotices.add(SESSION_REPLAY_TRUNCATED_NOTICE);

    const nowOffsetMs: number = this.getOffset(Date.now());

    this.sink({
      payload: "[]",
      rawBytes: 0,
      eventCount: 0,
      chunkStartOffsetMs: nowOffsetMs,
      chunkEndOffsetMs: nowOffsetMs,
      hasFullSnapshot: false,
      isFinal: true,
      signals: this.signals,
      fidelityNotices: Array.from(this.fidelityNotices),
      traceIds: Array.from(this.traceIds),
      routes: Array.from(this.routes),
    });

    this.resetPerChunkCounters();

    if (this.onTruncated) {
      this.onTruncated();
    }
  }

  public hasEmittedTruncation(): boolean {
    return this.truncationEmitted;
  }

  public getDroppedEventCount(): number {
    return this.droppedEvents;
  }

  private resetPerChunkCounters(): void {
    /*
     * Signal counters and trace ids are per chunk: the finalizer SUMS them
     * across chunks, so carrying them forward would double count. Fidelity
     * notices are deliberately NOT reset - they describe the page, not the
     * chunk, and a viewer who seeks into the middle of a session still needs
     * to be told the canvas was never recorded.
     */
    this.signals = Chunker.emptySignals();
    this.traceIds = new Set<string>();
    this.traceIdBytes = 0;

    /*
     * Reset with the rest: the finalizer UNIONS routes across chunks, so
     * carrying them forward would only make every chunk after the first
     * repeat the whole history for no gain.
     */
    this.routes = new Set<string>();
    this.routeBytes = 0;
  }

  public getOpenByteSize(): number {
    return this.open === null ? 0 : this.open.bytes;
  }

  public getOpenEventCount(): number {
    return this.open === null ? 0 : this.open.eventCount;
  }

  public getClosedChunkCount(): number {
    return this.closedChunkCount;
  }

  /*
   * Hard stop per session. Prevents one pathological tab from writing an
   * unbounded row count under a single sort-key prefix.
   */
  public hasReachedSessionChunkCap(): boolean {
    return this.closedChunkCount >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION;
  }

  public countSignal(
    key: keyof SessionReplaySignalCounts,
    by: number = 1,
  ): void {
    /*
     * The engagement counters are optional on the wire type, so a missing
     * one reads as undefined; every counter this class emits starts at 0
     * (emptySignals), but the arithmetic must not depend on that.
     */
    this.signals[key] = (this.signals[key] || 0) + by;
  }

  public addFidelityNotice(notice: SessionReplayFidelityNotice | string): void {
    this.fidelityNotices.add(notice);
  }

  /*
   * A correlation id for one request in this chunk. Capped by count and by
   * bytes: these ride the envelope JSON, which the server refuses outright
   * over 8 KB - a refusal that costs the WHOLE frame, not the trace ids.
   * Past the cap the request is still recorded in-band; only the envelope's
   * quick-join list stops growing.
   */
  public addTraceId(traceId: string): void {
    if (!traceId || this.traceIds.size >= MAX_TRACE_IDS_PER_CHUNK) {
      return;
    }

    if (this.traceIds.has(traceId)) {
      return;
    }

    const bytes: number = utf8ByteLength(traceId);

    if (this.traceIdBytes + bytes > MAX_TRACE_ID_BYTES_PER_CHUNK) {
      return;
    }

    this.traceIdBytes += bytes;
    this.traceIds.add(traceId);
  }

  /*
   * Called for the entry URL at start and for the destination of every route
   * change. Capped so a page that rewrites its path on every keystroke
   * cannot grow one envelope without bound; the cap is per chunk, and
   * routeCount still counts every change past it.
   */
  public addRoute(url: string): void {
    if (!url || this.routes.size >= MAX_ROUTES_PER_CHUNK) {
      return;
    }

    if (this.routes.has(url)) {
      return;
    }

    const bytes: number = utf8ByteLength(url);

    if (this.routeBytes + bytes > MAX_ROUTE_BYTES_PER_CHUNK) {
      return;
    }

    this.routeBytes += bytes;
    this.routes.add(url);
  }

  public getSignals(): SessionReplaySignalCounts {
    return this.signals;
  }

  public getFidelityNotices(): Array<string> {
    return Array.from(this.fidelityNotices);
  }

  private getOffset(timestampMs: number): number {
    return Math.max(0, timestampMs - this.sessionStartUnixMs);
  }
}
