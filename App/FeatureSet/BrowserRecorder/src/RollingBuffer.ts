import {
  SESSION_REPLAY_ROLLING_BUFFER_BYTES,
  SESSION_REPLAY_ROLLING_BUFFER_MS,
} from "Common/Types/Rum/SessionReplay";

/*
 * The pre-roll ring buffer.
 *
 * This is the mechanism behind the central bet of the whole feature: in the
 * default capture mode nothing is uploaded until something actually goes
 * wrong, so the recorder has to hold the seconds LEADING UP TO the failure
 * in memory and upload them retroactively.
 *
 * Eviction is by rrweb checkout SEGMENT, not by individual event, and that
 * distinction is the difference between a usable recording and a useless
 * one. An rrweb event stream is only replayable from a FullSnapshot:
 * incremental mutations address nodes by ids that the snapshot established.
 * Dropping the oldest few events would leave the buffer starting mid-stream,
 * so the player would have mutations referencing node ids it never saw. By
 * grouping events into segments that each begin with a checkout snapshot, we
 * can drop whole segments and whatever remains is still replayable from its
 * first event.
 *
 * The byte ceiling matters more than the duration: a heavily dynamic page
 * can blow past 2 MB in well under 60 s, and a recorder that OOMs the host
 * page is strictly worse than no recorder.
 */

export interface BufferedEvent {
  /*
   * The event, already serialised. Serialising once at push time means the
   * byte accounting is exact rather than estimated, the chunk payload is
   * built by string concatenation instead of a second full stringify, and
   * the buffer holds an immutable snapshot rather than an object rrweb (or
   * the host page) could still mutate.
   */
  json: string;
  bytes: number;
  timestampMs: number;
  isCheckout: boolean;

  /*
   * rrweb EventType, kept alongside the serialised form so the chunker can
   * reason about snapshot boundaries without re-parsing the JSON.
   */
  type: number;
}

interface BufferSegment {
  events: Array<BufferedEvent>;
  bytes: number;
}

export default class RollingBuffer {
  private segments: Array<BufferSegment> = [];
  private totalBytes: number = 0;
  private droppedEvents: number = 0;
  private overflowed: boolean = false;

  private readonly maxAgeMs: number;
  private readonly maxBytes: number;

  public constructor(
    maxAgeMs: number = SESSION_REPLAY_ROLLING_BUFFER_MS,
    maxBytes: number = SESSION_REPLAY_ROLLING_BUFFER_BYTES,
  ) {
    this.maxAgeMs = maxAgeMs;
    this.maxBytes = maxBytes;
  }

  public push(event: BufferedEvent): void {
    if (event.isCheckout || this.segments.length === 0) {
      this.segments.push({ events: [], bytes: 0 });
    }

    const segment: BufferSegment | undefined =
      this.segments[this.segments.length - 1];

    if (!segment) {
      return;
    }

    segment.events.push(event);
    segment.bytes += event.bytes;
    this.totalBytes += event.bytes;

    this.evict(event.timestampMs);
  }

  /*
   * Drop whole segments from the front while either cap is exceeded, but
   * never the newest segment - that one is the only replayable material we
   * have. If the newest segment alone is over the byte cap there is no
   * segment-shaped choice left, so events are dropped from its front and the
   * buffer reports an overflow, which the recorder turns into a
   * buffer-overflow fidelity notice on the chunk. The viewer is told the
   * recording is incomplete rather than silently shown a partial DOM.
   */
  private evict(nowMs: number): void {
    while (
      this.segments.length > 1 &&
      (this.totalBytes > this.maxBytes || this.isOldestSegmentExpired(nowMs))
    ) {
      const dropped: BufferSegment | undefined = this.segments.shift();

      if (!dropped) {
        break;
      }

      this.totalBytes -= dropped.bytes;
      this.droppedEvents += dropped.events.length;
    }

    if (this.totalBytes <= this.maxBytes) {
      return;
    }

    const only: BufferSegment | undefined = this.segments[0];

    if (!only) {
      return;
    }

    while (only.events.length > 1 && this.totalBytes > this.maxBytes) {
      const dropped: BufferedEvent | undefined = only.events.shift();

      if (!dropped) {
        break;
      }

      only.bytes -= dropped.bytes;
      this.totalBytes -= dropped.bytes;
      this.droppedEvents++;
      this.overflowed = true;
    }
  }

  private isOldestSegmentExpired(nowMs: number): boolean {
    const oldest: BufferSegment | undefined = this.segments[0];
    const newest: BufferSegment | undefined =
      this.segments[this.segments.length - 1];

    if (!oldest || !newest) {
      return false;
    }

    /*
     * Expiry is judged on the segment's LAST event, not its first: a
     * segment whose most recent event is still inside the window is still
     * needed to replay up to now.
     */
    const last: BufferedEvent | undefined =
      oldest.events[oldest.events.length - 1];

    if (!last) {
      return true;
    }

    return nowMs - last.timestampMs > this.maxAgeMs;
  }

  /*
   * Hand over everything held, in order, and reset. Used when a trigger
   * fires: the pre-roll becomes the first chunk (or chunks) of the upload
   * and the recorder switches to streaming straight into the chunker.
   */
  public drain(): Array<BufferedEvent> {
    const events: Array<BufferedEvent> = [];

    for (const segment of this.segments) {
      for (const event of segment.events) {
        events.push(event);
      }
    }

    this.segments = [];
    this.totalBytes = 0;

    return events;
  }

  /*
   * Release everything without handing it over. Called on revokeConsent()
   * and when the circuit breaker trips - in both cases holding on to end
   * user content we will never upload is pure liability.
   */
  public clear(): void {
    this.segments = [];
    this.totalBytes = 0;
  }

  public getByteSize(): number {
    return this.totalBytes;
  }

  public getEventCount(): number {
    return this.segments.reduce(
      (total: number, segment: BufferSegment): number => {
        return total + segment.events.length;
      },
      0,
    );
  }

  public getSegmentCount(): number {
    return this.segments.length;
  }

  public getDroppedEventCount(): number {
    return this.droppedEvents;
  }

  public hasOverflowed(): boolean {
    return this.overflowed;
  }
}
