import ReplayChunkBuffer, {
  BufferedReplaySegment,
  RollingReplayBuffer,
} from "../src/ChunkBuffer";
import {
  RrwebEventType,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SessionReplayFidelityNotice,
} from "../src/Contract";

describe("mobile chunk buffering", () => {
  /*
   * Issue #6443. A signal of the application's own is counted by name on
   * the envelope, with how many of its hits were frustration, exactly as
   * the browser's Chunker counts it; the ingest worker reads the counts
   * without opening the payload.
   */
  describe("signals of the application's own", () => {
    const signalEvent: (timestamp: number) => {
      type: RrwebEventType;
      data: unknown;
      timestamp: number;
    } = (timestamp: number) => {
      return { type: RrwebEventType.Custom, data: {}, timestamp };
    };

    test("counts each signal by name, and its frustration separately", () => {
      const buffer: ReplayChunkBuffer = new ReplayChunkBuffer();

      buffer.append(signalEvent(1_000), {
        customSignal: { name: "Payment failed", isFrustration: true },
      });
      buffer.append(signalEvent(1_100), {
        customSignal: { name: "Help opened", isFrustration: false },
      });
      buffer.append(signalEvent(1_200), {
        customSignal: { name: "Payment failed", isFrustration: true },
      });

      const segment: BufferedReplaySegment | null = buffer.take();

      expect(segment?.signals.customSignals).toEqual([
        { name: "Payment failed", count: 2, frustrationCount: 2 },
        { name: "Help opened", count: 1, frustrationCount: 0 },
      ]);
      /* The next chunk starts from nothing. */
      buffer.append(signalEvent(2_000), { route: "app://com.example.app/" });
      expect(buffer.take()?.signals.customSignals).toBeUndefined();
    });

    test("leaves the counts off a chunk that saw no signal", () => {
      const buffer: ReplayChunkBuffer = new ReplayChunkBuffer();

      buffer.append(signalEvent(1_000), { signal: "customEventCount" });

      expect(buffer.take()?.signals).not.toHaveProperty("customSignals");
    });

    test("hands out a copy, so a later chunk cannot change a taken one", () => {
      const buffer: ReplayChunkBuffer = new ReplayChunkBuffer();

      buffer.append(signalEvent(1_000), {
        customSignal: { name: "Payment failed", isFrustration: true },
      });
      const first: BufferedReplaySegment | null = buffer.take();
      buffer.append(signalEvent(2_000), {
        customSignal: { name: "Payment failed", isFrustration: true },
      });
      buffer.take();

      expect(first?.signals.customSignals).toEqual([
        { name: "Payment failed", count: 1, frustrationCount: 1 },
      ]);
    });

    test("holds at most fifty markers and twenty names a chunk", () => {
      const buffer: ReplayChunkBuffer = new ReplayChunkBuffer();
      let appended: number = 0;

      for (let index: number = 0; index < 80; index++) {
        if (!buffer.hasRoomForCustomSignal()) {
          break;
        }
        buffer.append(signalEvent(1_000 + index), {
          customSignal: { name: `Signal ${index}`, isFrustration: false },
        });
        appended += 1;
      }

      expect(appended).toBe(SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK);
      expect(buffer.hasRoomForCustomSignal()).toBe(false);
      const segment: BufferedReplaySegment | null = buffer.take();
      expect(segment?.signals.customSignals).toHaveLength(
        SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
      );
      /* A new chunk has room again. */
      expect(buffer.hasRoomForCustomSignal()).toBe(true);
    });
  });

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

  /*
   * Issue #5375. User Flows reads a journey from this order, so a screen the
   * user came back to has to stay where it happened.
   */
  describe("routes", () => {
    const appUrl: (screen: string) => string = (screen: string): string => {
      return `app://com.example.app/${screen}`;
    };

    function routesOf(screens: Array<string>): Array<string> {
      const buffer: ReplayChunkBuffer = new ReplayChunkBuffer();

      screens.forEach((screen: string, index: number): void => {
        buffer.append(
          { type: RrwebEventType.Custom, data: {}, timestamp: 1_000 + index },
          { route: screen },
        );
      });

      return buffer.take()?.routes ?? [];
    }

    test("keeps the order visited, returns included", () => {
      expect(
        routesOf([
          appUrl("list"),
          appUrl("item"),
          appUrl("list"),
          appUrl("cart"),
          appUrl("list"),
        ]),
      ).toEqual([
        appUrl("list"),
        appUrl("item"),
        appUrl("list"),
        appUrl("cart"),
        appUrl("list"),
      ]);
    });

    test("a screen repeated back to back is one entry", () => {
      expect(
        routesOf([appUrl("list"), appUrl("list"), appUrl("item")]),
      ).toEqual([appUrl("list"), appUrl("item")]);
    });

    test("an app flipping between two screens stays under the count cap", () => {
      const screens: Array<string> = [];

      for (let index: number = 0; index < 500; index++) {
        screens.push(appUrl(`tab-${index % 2}`));
      }

      /* Pinned, so doubling the cap fails here. */
      expect(routesOf(screens)).toHaveLength(32);
    });

    /*
     * The list rides the envelope, and the server refuses an envelope over
     * 8 KB outright. Keeping returns must never be what loses a recording.
     */
    test("long routes stay under the byte budget", () => {
      const screens: Array<string> = [];

      for (let index: number = 0; index < 32; index++) {
        screens.push(appUrl(`${"a".repeat(400)}/${index}`));
      }

      const routes: Array<string> = routesOf(screens);
      const bytes: number = routes.reduce(
        (total: number, route: string): number => {
          return total + route.length;
        },
        0,
      );

      expect(bytes).toBeLessThanOrEqual(2 * 1024);
      expect(routes.length).toBeGreaterThan(0);
    });

    test("the caps are per chunk", () => {
      const buffer: ReplayChunkBuffer = new ReplayChunkBuffer();

      for (let index: number = 0; index < 100; index++) {
        buffer.append(
          { type: RrwebEventType.Custom, data: {}, timestamp: 1_000 + index },
          { route: appUrl(`step-${index}`) },
        );
      }

      expect(buffer.take()?.routes).toHaveLength(32);

      buffer.append(
        { type: RrwebEventType.Custom, data: {}, timestamp: 2_000 },
        { route: appUrl("next-chunk") },
      );

      expect(buffer.take()?.routes).toEqual([appUrl("next-chunk")]);
    });
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
