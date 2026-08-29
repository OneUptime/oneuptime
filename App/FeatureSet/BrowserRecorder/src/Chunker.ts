import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_FLUSH_BYTES,
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
const EVENT_TYPE_FULL_SNAPSHOT: number = 2;
const EVENT_TYPE_META: number = 4;

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
 * 2 KB leaves the rest of the envelope (ids, versions, signals, trace ids,
 * fidelity notices) comfortable room inside the 8 KB ceiling. A chunk covers
 * ~15s, so a page doing more DISTINCT navigations than these caps allow is
 * rewriting its URL programmatically rather than being navigated by a
 * person; routeCount still counts every change past them.
 */
const MAX_ROUTES_PER_CHUNK: number = 32;
const MAX_ROUTE_BYTES_PER_CHUNK: number = 2 * 1024;

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

/*
 * Cut a string into pieces of at most maxBytes UTF-8 bytes each, never
 * between the two halves of a surrogate pair.
 *
 * Slicing by code unit split emoji and other astral characters down the
 * middle, and because each part is UTF-8 encoded INDEPENDENTLY before it goes
 * on the wire, both halves of a broken pair became U+FFFD - so the server's
 * reassembled snapshot was silently corrupted rather than failing loudly.
 * Cutting on code-point boundaries keeps every part independently valid,
 * which makes the reassembly correct whether the server concatenates the
 * decoded strings or the raw bytes.
 */
export function splitByUtf8Bytes(
  value: string,
  maxBytes: number,
): Array<string> {
  if (value.length === 0) {
    return [""];
  }

  const parts: Array<string> = [];
  let start: number = 0;
  let bytes: number = 0;
  let index: number = 0;

  while (index < value.length) {
    const code: number = value.charCodeAt(index);
    const isHighSurrogate: boolean =
      code >= 0xd800 && code <= 0xdbff && index + 1 < value.length;
    const next: number = isHighSurrogate ? value.charCodeAt(index + 1) : 0;
    const isPair: boolean = isHighSurrogate && next >= 0xdc00 && next <= 0xdfff;

    const width: number = isPair ? 2 : 1;
    const cost: number = utf8ByteLength(value.slice(index, index + width));

    if (bytes + cost > maxBytes && index > start) {
      parts.push(value.slice(start, index));
      start = index;
      bytes = 0;
    }

    bytes += cost;
    index += width;
  }

  parts.push(value.slice(start));

  return parts;
}

export interface PendingChunk {
  /*
   * The chunk body before compression. Normally a complete JSON array of
   * rrweb events. For a split snapshot (see below) it is a FRAGMENT of that
   * array's text, and the receiving side must concatenate the parts by
   * chunkIndex before parsing.
   */
  payload: string;

  rawBytes: number;
  eventCount: number;

  chunkStartOffsetMs: number;
  chunkEndOffsetMs: number;

  hasFullSnapshot: boolean;
  isFinal: boolean;

  snapshotPart?: {
    index: number;
    total: number;
  };

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
  events: Array<string>;
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
     * A FullSnapshot is ONE indivisible rrweb event: it cannot be split
     * across chunks and still parse. On a large DOM it can exceed the flush
     * threshold on its own, so it gets its own multi-part chunk sequence
     * with hasFullSnapshot set on the final part only. Without this, a seek
     * anchor would point at a chunk holding half a snapshot and the player
     * would rebuild a partial DOM.
     */
    if (event.bytes + 2 > this.maxPayloadBytes) {
      this.close(false);
      this.emitSplitEvent(event);
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
      event.type !== EVENT_TYPE_FULL_SNAPSHOT
    ) {
      this.open.sawContentEvent = true;
    }

    this.open.events.push(event.json);
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
      payload: `[${open.events.join(",")}]`,
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
   * Split one oversized event across as many chunks as it needs.
   *
   * The parts carry raw slices of the array text, so only the concatenation
   * of all parts is valid JSON. snapshotPart tells the receiving side how
   * many to expect, and hasFullSnapshot is set only on the last one so no
   * seek anchor ever points into the middle of a snapshot.
   */
  private emitSplitEvent(event: BufferedEvent): void {
    const body: string = `[${event.json}]`;
    const slices: Array<string> = splitByUtf8Bytes(body, this.maxPayloadBytes);
    const partCount: number = slices.length;
    const offsetMs: number = this.getOffset(event.timestampMs);

    for (let index: number = 0; index < partCount; index++) {
      if (this.hasReachedSessionChunkCap()) {
        this.droppedEvents++;
        this.emitTruncationChunk();
        return;
      }

      const slice: string = slices[index] as string;

      const isLastPart: boolean = index === partCount - 1;

      this.closedChunkCount++;

      this.sink({
        payload: slice,
        rawBytes: utf8ByteLength(slice),

        /*
         * Only the last part reports the event, so summing eventCount over
         * the session does not multiply-count one snapshot.
         */
        eventCount: isLastPart ? 1 : 0,
        chunkStartOffsetMs: offsetMs,
        chunkEndOffsetMs: offsetMs,
        hasFullSnapshot: isLastPart && event.type === EVENT_TYPE_FULL_SNAPSHOT,
        isFinal: false,
        snapshotPart: { index: index, total: partCount },
        signals: this.signals,
        fidelityNotices: Array.from(this.fidelityNotices),
        traceIds: Array.from(this.traceIds),
        routes: Array.from(this.routes),
      });

      this.resetPerChunkCounters();
    }
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
    this.signals[key] += by;
  }

  public addFidelityNotice(notice: SessionReplayFidelityNotice | string): void {
    this.fidelityNotices.add(notice);
  }

  public addTraceId(traceId: string): void {
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
