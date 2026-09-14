import {
  RrwebEvent,
  RrwebEventType,
  SESSION_REPLAY_FLUSH_BYTES,
  SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES,
  SESSION_REPLAY_ROLLING_BUFFER_BYTES,
  SESSION_REPLAY_ROLLING_BUFFER_MS,
  SessionReplayFidelityNotice,
  SessionReplaySignalCounts,
} from "./Contract";
import { byteLength, emptySignalCounts } from "./Sanitize";

export interface BufferedReplaySegment {
  payload: string;
  eventCount: number;
  startUnixMs: number;
  endUnixMs: number;
  hasFullSnapshot: boolean;
  routes: Array<string>;
  signals: SessionReplaySignalCounts;
  fidelityNotices: Array<SessionReplayFidelityNotice>;
  droppedEvents: number;
}

export default class ReplayChunkBuffer {
  private events: Array<RrwebEvent> = [];
  private approximateBytes: number = 2;
  private startUnixMs: number = 0;
  private endUnixMs: number = 0;
  private hasFullSnapshot: boolean = false;
  private routes: Array<string> = [];
  private readonly fidelity: Set<SessionReplayFidelityNotice> =
    new Set<SessionReplayFidelityNotice>();
  private signals: SessionReplaySignalCounts = emptySignalCounts();
  private droppedEvents: number = 0;

  public append(
    event: RrwebEvent,
    options?: {
      route?: string;
      fidelityNotices?: Array<SessionReplayFidelityNotice>;
      signal?: keyof SessionReplaySignalCounts;
    },
  ): boolean {
    let serialized: string;
    try {
      serialized = JSON.stringify(event);
    } catch {
      this.droppedEvents += 1;
      return false;
    }

    const eventBytes: number = byteLength(serialized) + 1;
    if (eventBytes > SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES) {
      this.droppedEvents += 1;
      this.fidelity.add(SessionReplayFidelityNotice.SnapshotTooLarge);
      return false;
    }

    this.events.push(event);
    this.approximateBytes += eventBytes;
    this.startUnixMs =
      this.startUnixMs === 0 ? event.timestamp : this.startUnixMs;
    this.endUnixMs = Math.max(this.endUnixMs, event.timestamp);
    if (event.type === RrwebEventType.FullSnapshot) {
      this.hasFullSnapshot = true;
    }

    if (options?.route && !this.routes.includes(options.route)) {
      this.routes.push(options.route);
    }
    for (const notice of options?.fidelityNotices ?? []) {
      this.fidelity.add(notice);
    }
    if (options?.signal) {
      const current: number = this.signals[options.signal] ?? 0;
      this.signals[options.signal] = current + 1;
    }

    return true;
  }

  public appendMany(
    events: Array<RrwebEvent>,
    options?: {
      route?: string;
      fidelityNotices?: Array<SessionReplayFidelityNotice>;
    },
  ): number {
    let accepted: number = 0;
    for (const event of events) {
      if (this.append(event, options)) {
        accepted += 1;
      }
    }

    return accepted;
  }

  public shouldFlush(): boolean {
    return this.approximateBytes >= SESSION_REPLAY_FLUSH_BYTES;
  }

  public isEmpty(): boolean {
    return this.events.length === 0;
  }

  public take(): BufferedReplaySegment | null {
    if (this.events.length === 0) {
      return null;
    }

    const payload: string = JSON.stringify(this.events);
    const segment: BufferedReplaySegment = {
      payload,
      eventCount: this.events.length,
      startUnixMs: this.startUnixMs,
      endUnixMs: this.endUnixMs,
      hasFullSnapshot: this.hasFullSnapshot,
      routes: this.routes.slice(),
      signals: { ...this.signals },
      fidelityNotices: Array.from(this.fidelity),
      droppedEvents: this.droppedEvents,
    };
    this.reset();
    return segment;
  }

  public clear(): void {
    this.reset();
  }

  private reset(): void {
    this.events = [];
    this.approximateBytes = 2;
    this.startUnixMs = 0;
    this.endUnixMs = 0;
    this.hasFullSnapshot = false;
    this.routes = [];
    this.fidelity.clear();
    this.signals = emptySignalCounts();
    this.droppedEvents = 0;
  }
}

export class RollingReplayBuffer {
  private segments: Array<BufferedReplaySegment> = [];
  private bytes: number = 0;
  private overflowed: boolean = false;

  public push(segment: BufferedReplaySegment, nowUnixMs: number): void {
    this.segments.push(segment);
    this.bytes += byteLength(segment.payload);
    const cutoff: number = nowUnixMs - SESSION_REPLAY_ROLLING_BUFFER_MS;

    while (
      this.segments.length > 0 &&
      (this.bytes > SESSION_REPLAY_ROLLING_BUFFER_BYTES ||
        (this.segments[0]?.endUnixMs ?? nowUnixMs) < cutoff)
    ) {
      const removed: BufferedReplaySegment | undefined = this.segments.shift();
      if (removed) {
        this.bytes -= byteLength(removed.payload);
        this.overflowed = true;
      }
    }
  }

  public drain(): Array<BufferedReplaySegment> {
    const segments: Array<BufferedReplaySegment> = this.segments;
    if (this.overflowed && segments[0]) {
      const notices: Set<SessionReplayFidelityNotice> = new Set(
        segments[0].fidelityNotices,
      );
      notices.add(SessionReplayFidelityNotice.BufferOverflow);
      segments[0] = {
        ...segments[0],
        fidelityNotices: Array.from(notices),
      };
    }

    this.clear();
    return segments;
  }

  public clear(): void {
    this.segments = [];
    this.bytes = 0;
    this.overflowed = false;
  }

  public get length(): number {
    return this.segments.length;
  }
}
