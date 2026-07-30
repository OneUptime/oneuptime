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

  private open: OpenChunk | null = null;
  private closedChunkCount: number = 0;

  private signals: SessionReplaySignalCounts = Chunker.emptySignals();
  private readonly fidelityNotices: Set<string> = new Set<string>();
  private traceIds: Set<string> = new Set<string>();

  public constructor(options: {
    sessionStartUnixMs: number;
    sink: ChunkSink;
    maxPayloadBytes?: number;
  }) {
    this.sessionStartUnixMs = options.sessionStartUnixMs;
    this.sink = options.sink;
    this.maxPayloadBytes =
      options.maxPayloadBytes === undefined
        ? SESSION_REPLAY_FLUSH_BYTES
        : options.maxPayloadBytes;
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

    if (!open || open.eventCount === 0) {
      if (isFinal) {
        this.emitEmptyFinalChunk();
      }
      return;
    }

    if (this.hasReachedSessionChunkCap()) {
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
    const partCount: number = Math.ceil(body.length / this.maxPayloadBytes);
    const offsetMs: number = this.getOffset(event.timestampMs);

    for (let index: number = 0; index < partCount; index++) {
      if (this.hasReachedSessionChunkCap()) {
        return;
      }

      const slice: string = body.slice(
        index * this.maxPayloadBytes,
        (index + 1) * this.maxPayloadBytes,
      );

      const isLastPart: boolean = index === partCount - 1;

      this.closedChunkCount++;

      this.sink({
        payload: slice,
        rawBytes: slice.length,

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
      });

      this.resetPerChunkCounters();
    }
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
