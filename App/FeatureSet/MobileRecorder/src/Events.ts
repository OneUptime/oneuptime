import {
  RrwebEvent,
  RrwebEventType,
  RrwebIncrementalSource,
  RrwebMouseInteractionType,
} from "./Contract";
import { RRWEB_BODY_NODE_ID } from "./ViewTreeSerializer";

export type TouchPhase = "start" | "move" | "end";

export interface RecordedTouch {
  phase: TouchPhase;
  x: number;
  y: number;
  timestamp: number;
  targetTag?: number;
  pointerId?: number | string;
}

const MAX_TOUCH_CLOCK_SKEW_MS: number = 60_000;

function coordinate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(-100_000, Math.min(100_000, value))
    : 0;
}

export function sanitizeRecordedTouch(
  value: unknown,
  nowUnixMs: number,
): RecordedTouch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw: Partial<Record<keyof RecordedTouch, unknown>> = value as Partial<
    Record<keyof RecordedTouch, unknown>
  >;
  if (raw.phase !== "start" && raw.phase !== "move" && raw.phase !== "end") {
    return null;
  }

  const safeNowUnixMs: number = Number.isFinite(nowUnixMs)
    ? nowUnixMs
    : Date.now();
  const candidateTimestamp: unknown = raw.timestamp;
  const timestamp: number =
    typeof candidateTimestamp === "number" &&
    Number.isFinite(candidateTimestamp) &&
    candidateTimestamp >= safeNowUnixMs - MAX_TOUCH_CLOCK_SKEW_MS &&
    candidateTimestamp <= safeNowUnixMs + MAX_TOUCH_CLOCK_SKEW_MS
      ? candidateTimestamp
      : safeNowUnixMs;

  const touch: RecordedTouch = {
    phase: raw.phase,
    x: coordinate(raw.x),
    y: coordinate(raw.y),
    timestamp,
  };
  if (
    typeof raw.targetTag === "number" &&
    Number.isSafeInteger(raw.targetTag) &&
    raw.targetTag > 0
  ) {
    touch.targetTag = raw.targetTag;
  }
  if (
    (typeof raw.pointerId === "number" &&
      Number.isSafeInteger(raw.pointerId)) ||
    (typeof raw.pointerId === "string" && raw.pointerId.length <= 100)
  ) {
    touch.pointerId = raw.pointerId as number | string;
  }
  return touch;
}

export function createTouchEvent(touch: RecordedTouch): RrwebEvent {
  const x: number = coordinate(touch.x);
  const y: number = coordinate(touch.y);

  if (touch.phase === "move") {
    return {
      type: RrwebEventType.IncrementalSnapshot,
      data: {
        source: RrwebIncrementalSource.TouchMove,
        positions: [
          {
            x,
            y,
            id: RRWEB_BODY_NODE_ID,
            timeOffset: 0,
          },
        ],
      },
      timestamp: touch.timestamp,
    };
  }

  return {
    type: RrwebEventType.IncrementalSnapshot,
    data: {
      source: RrwebIncrementalSource.MouseInteraction,
      type:
        touch.phase === "start"
          ? RrwebMouseInteractionType.TouchStart
          : RrwebMouseInteractionType.TouchEnd,
      id: RRWEB_BODY_NODE_ID,
      x,
      y,
    },
    timestamp: touch.timestamp,
  };
}

export function createCustomEvent(
  tag: string,
  payload: unknown,
  timestamp: number,
): RrwebEvent {
  return {
    type: RrwebEventType.Custom,
    data: { tag, payload },
    timestamp,
  };
}
