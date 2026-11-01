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
