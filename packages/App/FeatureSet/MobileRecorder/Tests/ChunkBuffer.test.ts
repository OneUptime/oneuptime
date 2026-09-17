import ReplayChunkBuffer, {
  BufferedReplaySegment,
  RollingReplayBuffer,
} from "../src/ChunkBuffer";
import { RrwebEventType, SessionReplayFidelityNotice } from "../src/Contract";

describe("mobile chunk buffering", () => {
  test("tracks checkouts, routes, signals, and notices in the envelope sidecar", () => {
    const buffer: ReplayChunkBuffer = new ReplayChunkBuffer();
    buffer.append(
      { type: RrwebEventType.FullSnapshot, data: {}, timestamp: 1_000 },
      {
        route: "app://com.example.app/",
        fidelityNotices: [SessionReplayFidelityNotice.MobileAnimationSampled],
        signal: "errorCount",
      },
    );
    buffer.append(
      { type: RrwebEventType.Custom, data: {}, timestamp: 1_100 },
      { route: "app://com.example.app/next", signal: "customEventCount" },
    );

    const segment: BufferedReplaySegment | null = buffer.take();
    expect(segment).toMatchObject({
      eventCount: 2,
      startUnixMs: 1_000,
      endUnixMs: 1_100,
      hasFullSnapshot: true,
      routes: ["app://com.example.app/", "app://com.example.app/next"],
    });
    expect(segment?.signals.errorCount).toBe(1);
    expect(segment?.signals.customEventCount).toBe(1);
    expect(segment?.fidelityNotices).toContain(
      SessionReplayFidelityNotice.MobileAnimationSampled,
    );
    expect(JSON.parse(segment?.payload ?? "[]")).toHaveLength(2);
    expect(buffer.isEmpty()).toBe(true);
  });

  test("rolling buffer drains in order and can be privacy-cleared", () => {
    const current: ReplayChunkBuffer = new ReplayChunkBuffer();
    const rolling: RollingReplayBuffer = new RollingReplayBuffer();
    current.append({ type: RrwebEventType.Meta, data: { n: 1 }, timestamp: 1 });
    rolling.push(current.take()!, 1);
    current.append({ type: RrwebEventType.Meta, data: { n: 2 }, timestamp: 2 });
    rolling.push(current.take()!, 2);
    expect(
      rolling.drain().map((segment: BufferedReplaySegment) => {
        return segment.startUnixMs;
      }),
    ).toEqual([1, 2]);
    expect(rolling.length).toBe(0);
    current.append({ type: RrwebEventType.Meta, data: {}, timestamp: 3 });
    rolling.push(current.take()!, 3);
    rolling.clear();
    expect(rolling.length).toBe(0);
  });
});
