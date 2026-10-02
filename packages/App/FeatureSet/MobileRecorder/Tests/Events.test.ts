import {
  IDLE_PAUSED_CUSTOM_EVENT_TAG,
  IDLE_RESUMED_CUSTOM_EVENT_TAG,
  RrwebEvent,
  RrwebEventType,
  RrwebIncrementalSource,
  RrwebMouseInteractionType,
  SessionReplayIdlePausedPayload,
  SessionReplayIdleResumedPayload,
} from "../src/Contract";
import {
  createCustomEvent,
  createTouchEvent,
  sanitizeRecordedTouch,
} from "../src/Events";

describe("touch event projection", () => {
  test("maps start/end to rrweb mouse interactions", () => {
    expect(
      createTouchEvent({ phase: "start", x: 12, y: 34, timestamp: 100 }).data,
    ).toEqual({
      source: RrwebIncrementalSource.MouseInteraction,
      type: RrwebMouseInteractionType.TouchStart,
      id: 5,
      x: 12,
      y: 34,
    });
    expect(
      createTouchEvent({ phase: "end", x: 12, y: 34, timestamp: 101 }).data,
    ).toEqual(
      expect.objectContaining({ type: RrwebMouseInteractionType.TouchEnd }),
    );
  });

  test("maps movement to rrweb TouchMove and clamps hostile coordinates", () => {
    const event: RrwebEvent = createTouchEvent({
      phase: "move",
      x: Number.POSITIVE_INFINITY,
      y: -200_000,
      timestamp: 100,
    });
    expect(event.data).toEqual({
      source: RrwebIncrementalSource.TouchMove,
      positions: [{ x: 0, y: -100_000, id: 5, timeOffset: 0 }],
    });
  });

  test("writes the idle pause and resume markers as rrweb custom events", () => {
    const paused: SessionReplayIdlePausedPayload = {
      idleSinceUnixMs: 1_000,
      pausedAtUnixMs: 301_000,
    };
    const resumed: SessionReplayIdleResumedPayload = {
      pausedAtUnixMs: 301_000,
      resumedAtUnixMs: 420_000,
    };

    expect(
      createCustomEvent(IDLE_PAUSED_CUSTOM_EVENT_TAG, paused, 301_000),
    ).toEqual({
      type: RrwebEventType.Custom,
      timestamp: 301_000,
      data: { tag: "oneuptime.idle-paused", payload: paused },
    });
    expect(
      createCustomEvent(IDLE_RESUMED_CUSTOM_EVENT_TAG, resumed, 420_000),
    ).toEqual({
      type: RrwebEventType.Custom,
      timestamp: 420_000,
      data: { tag: "oneuptime.idle-resumed", payload: resumed },
    });
  });

  test("rejects unknown phases and canonicalizes hostile public touch values", () => {
    expect(sanitizeRecordedTouch(null, 1_000)).toBeNull();
    expect(
      sanitizeRecordedTouch(
        { phase: "tap", x: 1, y: 2, timestamp: 1_000 },
        1_000,
      ),
    ).toBeNull();
    expect(
      sanitizeRecordedTouch(
        {
          phase: "start",
          x: Number.POSITIVE_INFINITY,
          y: Number.NaN,
          timestamp: Number.POSITIVE_INFINITY,
        },
        1_000,
      ),
    ).toEqual({ phase: "start", x: 0, y: 0, timestamp: 1_000 });
  });
});
