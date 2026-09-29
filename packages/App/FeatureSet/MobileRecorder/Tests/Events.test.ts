import {
  RrwebEvent,
  RrwebIncrementalSource,
  RrwebMouseInteractionType,
} from "../src/Contract";
import { createTouchEvent, sanitizeRecordedTouch } from "../src/Events";

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
