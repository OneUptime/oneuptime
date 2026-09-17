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
 *
 * When only ONE segment is left and it alone is over the cap there is no
 * segment-shaped choice, and the naive answer - drop from the front - is the
 * worst possible one: the front of a segment is its Meta and FullSnapshot,
 * so the first things evicted were the only two events that make the rest
 * replayable. The header is pinned instead and the OLDEST INCREMENTAL events
 * after it go first. What survives still opens on a snapshot; some early
 * mutations are missing, which the recorder discloses as a buffer-overflow
 * fidelity notice, and needsFreshCheckout() asks it for a new snapshot so
 * the next segment can be evicted whole again.
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

/* rrweb EventType values this module needs to recognise. */
const EVENT_TYPE_FULL_SNAPSHOT: number = 2;
const EVENT_TYPE_META: number = 4;

interface BufferSegment {
  events: Array<BufferedEvent>;
  bytes: number;

  /*
   * Whether anything other than a Meta or FullSnapshot has landed in this
   * segment yet.
   *
   * rrweb emits a checkout as TWO isCheckout events, Meta then FullSnapshot
   * (rrweb.js:14428-14446 passes the flag to both). Starting a segment on
   * every isCheckout therefore left the Meta alone in a segment of its own,
   * where it could be evicted independently of the FullSnapshot it belongs
   * to - leaving a pre-roll whose first event is a snapshot with no viewport
   * or href in front of it. The Chunker already gets this right the same way.
   */
  sawContentEvent: boolean;
}

export default class RollingBuffer {
  private segments: Array<BufferSegment> = [];
  private totalBytes: number = 0;
  private droppedEvents: number = 0;
  private overflowed: boolean = false;

  /*
   * Set when the sole segment lost incremental events to the byte cap. The
   * segment can no longer be trimmed without losing more of its history, so
   * the recorder should take a fresh checkout: that opens a new segment,
   * and the damaged one becomes evictable as a whole.
   */
  private freshCheckoutNeeded: boolean = false;

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
    const current: BufferSegment | undefined =
      this.segments[this.segments.length - 1];

    /*
     * A checkout only opens a new segment once the current one holds
     * something replayable. Without the sawContentEvent guard the checkout's
     * own Meta and FullSnapshot land in two different segments.
     */
    if (!current || (event.isCheckout && current.sawContentEvent)) {
      this.segments.push({ events: [], bytes: 0, sawContentEvent: false });

      /* The fresh checkout that needsFreshCheckout() asked for has arrived. */
      this.freshCheckoutNeeded = false;
    }

    const segment: BufferSegment | undefined =
      this.segments[this.segments.length - 1];

    if (!segment) {
      return;
    }

    if (
      event.type !== EVENT_TYPE_META &&
      event.type !== EVENT_TYPE_FULL_SNAPSHOT
    ) {
      segment.sawContentEvent = true;
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
   * segment-shaped choice left, so its oldest INCREMENTAL events are dropped
   * - never its Meta and FullSnapshot, which are what make the remainder
   * playable - and the buffer reports an overflow, which the recorder turns
   * into a buffer-overflow fidelity notice on the chunk. The viewer is told
   * the recording is incomplete rather than silently shown a partial DOM.
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

      /*
       * A segment that had lost events to the cap is gone whole; whatever
       * is left opens on its own intact checkout, so no fresh one is owed.
       */
      this.freshCheckoutNeeded = false;
    }

    if (this.totalBytes <= this.maxBytes) {
      return;
    }

    const only: BufferSegment | undefined = this.segments[0];

    if (!only) {
      return;
    }

    /*
     * The pinned header: every leading Meta / FullSnapshot event. Eviction
     * starts at the first event after it and always leaves at least one
     * event after it too, so the segment never collapses to a bare snapshot
     * with nothing to play.
     */
    const headerLength: number = RollingBuffer.checkoutHeaderLength(only);

    while (
      only.events.length > headerLength + 1 &&
      this.totalBytes > this.maxBytes
    ) {
      const dropped: Array<BufferedEvent> = only.events.splice(headerLength, 1);

      const event: BufferedEvent | undefined = dropped[0];

      if (!event) {
        break;
      }

      only.bytes -= event.bytes;
      this.totalBytes -= event.bytes;
      this.droppedEvents++;
      this.overflowed = true;
      this.freshCheckoutNeeded = true;
    }

    /*
     * Still over the cap with nothing evictable left: the snapshot itself
     * is bigger than the buffer. Nothing can be trimmed, so the only way
     * back under the cap is a new, smaller checkout.
     */
    if (this.totalBytes > this.maxBytes) {
      this.overflowed = true;
      this.freshCheckoutNeeded = true;
    }
  }

  /* How many leading events of a segment are its Meta / FullSnapshot pair. */
  private static checkoutHeaderLength(segment: BufferSegment): number {
    let length: number = 0;

    for (const event of segment.events) {
      if (
        event.type !== EVENT_TYPE_META &&
        event.type !== EVENT_TYPE_FULL_SNAPSHOT
      ) {
        break;
      }

      length++;
    }

    return length;
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
    this.freshCheckoutNeeded = false;

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
    this.freshCheckoutNeeded = false;
  }

  /*
   * Should the recorder take a fresh checkout right now?
   *
   * True once the sole segment has lost incremental events to the byte cap
   * (or its snapshot alone exceeds it). A new checkout opens a new segment;
   * the damaged one then becomes the oldest and is evicted whole on the next
   * push, which is the only way the buffer gets back to holding an intact
   * pre-roll. Cleared by the checkout itself, by drain() and by clear().
   */
  public needsFreshCheckout(): boolean {
    return this.freshCheckoutNeeded;
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
