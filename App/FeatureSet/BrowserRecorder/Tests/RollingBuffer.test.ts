import RollingBuffer, { BufferedEvent } from "../src/RollingBuffer";

describe("RollingBuffer", (): void => {
  const makeEvent: (overrides?: Partial<BufferedEvent>) => BufferedEvent = (
    overrides?: Partial<BufferedEvent>,
  ): BufferedEvent => {
    return {
      json: '{"type":3}',
      bytes: 100,
      timestampMs: 1000,
      isCheckout: false,
      type: 3,
      ...overrides,
    };
  };

  it("starts a new segment on a checkout event", (): void => {
    const buffer: RollingBuffer = new RollingBuffer();

    buffer.push(makeEvent({ isCheckout: true, type: 2 }));
    buffer.push(makeEvent());
    buffer.push(makeEvent({ isCheckout: true, type: 2 }));

    expect(buffer.getSegmentCount()).toBe(2);
  });

  /*
   * rrweb emits a checkout as TWO isCheckout events: Meta (type 4) then
   * FullSnapshot (type 2). Opening a segment on every isCheckout put the Meta
   * alone in a segment of its own, where it could be evicted independently of
   * the snapshot it belongs to - leaving a pre-roll whose first event is a
   * FullSnapshot with no viewport or href in front of it.
   */
  it("keeps a checkout's Meta and FullSnapshot in one segment", (): void => {
    const buffer: RollingBuffer = new RollingBuffer();

    buffer.push(makeEvent({ isCheckout: true, type: 4, json: "meta-1" }));
    buffer.push(makeEvent({ isCheckout: true, type: 2, json: "snap-1" }));
    buffer.push(makeEvent({ json: "content-1" }));

    buffer.push(makeEvent({ isCheckout: true, type: 4, json: "meta-2" }));
    buffer.push(makeEvent({ isCheckout: true, type: 2, json: "snap-2" }));

    expect(buffer.getSegmentCount()).toBe(2);
  });

  it("never evicts a Meta away from the snapshot it describes", (): void => {
    /* Cap sized so exactly one of the two checkout segments survives. */
    const buffer: RollingBuffer = new RollingBuffer(60000, 250);

    for (const round of [1, 2]) {
      buffer.push(
        makeEvent({
          isCheckout: true,
          type: 4,
          bytes: 50,
          json: `meta-${round}`,
        }),
      );
      buffer.push(
        makeEvent({
          isCheckout: true,
          type: 2,
          bytes: 50,
          json: `snap-${round}`,
        }),
      );
      buffer.push(makeEvent({ bytes: 100, json: `content-${round}` }));
    }

    const drained: Array<string> = buffer.drain().map((e: BufferedEvent) => {
      return e.json;
    });

    /* Whatever survived begins with a Meta, then its snapshot. */
    expect(drained[0]).toBe("meta-2");
    expect(drained[1]).toBe("snap-2");
    expect(drained).not.toContain("meta-1");
    expect(drained).not.toContain("snap-1");
  });

  /*
   * The central property: eviction drops WHOLE segments, so whatever remains
   * still begins with a full snapshot and is therefore still replayable.
   */
  it("evicts the oldest whole segment when over the byte cap", (): void => {
    const buffer: RollingBuffer = new RollingBuffer(60000, 250);

    buffer.push(makeEvent({ isCheckout: true, bytes: 100 }));
    buffer.push(makeEvent({ bytes: 100 }));

    /* Second segment pushes the total to 300, over the 250 cap. */
    buffer.push(makeEvent({ isCheckout: true, bytes: 100 }));

    expect(buffer.getSegmentCount()).toBe(1);
    expect(buffer.getEventCount()).toBe(1);
    expect(buffer.getDroppedEventCount()).toBe(2);
    expect(buffer.getByteSize()).toBe(100);
  });

  it("evicts segments older than the age cap", (): void => {
    const buffer: RollingBuffer = new RollingBuffer(1000, 1024 * 1024);

    buffer.push(makeEvent({ isCheckout: true, timestampMs: 0 }));
    buffer.push(makeEvent({ timestampMs: 100 }));
    buffer.push(makeEvent({ isCheckout: true, timestampMs: 5000 }));

    expect(buffer.getSegmentCount()).toBe(1);
    expect(buffer.getDroppedEventCount()).toBe(2);
  });

  it("keeps a segment whose last event is still inside the window", (): void => {
    const buffer: RollingBuffer = new RollingBuffer(1000, 1024 * 1024);

    buffer.push(makeEvent({ isCheckout: true, timestampMs: 0 }));
    buffer.push(makeEvent({ timestampMs: 900 }));
    buffer.push(makeEvent({ isCheckout: true, timestampMs: 1000 }));

    expect(buffer.getSegmentCount()).toBe(2);
  });

  /*
   * When only one segment is left there is no segment-shaped choice, so events
   * are dropped from its front and the overflow is DISCLOSED rather than
   * hidden - the viewer is told the recording is incomplete.
   */
  it("reports an overflow when a single segment exceeds the byte cap", (): void => {
    const buffer: RollingBuffer = new RollingBuffer(60000, 250);

    buffer.push(makeEvent({ isCheckout: true, bytes: 100 }));
    buffer.push(makeEvent({ bytes: 100 }));
    buffer.push(makeEvent({ bytes: 100 }));

    expect(buffer.getSegmentCount()).toBe(1);
    expect(buffer.hasOverflowed()).toBe(true);
    expect(buffer.getByteSize()).toBeLessThanOrEqual(250);
  });

  it("never drops the last remaining event", (): void => {
    const buffer: RollingBuffer = new RollingBuffer(60000, 10);

    buffer.push(makeEvent({ isCheckout: true, bytes: 5000 }));

    expect(buffer.getEventCount()).toBe(1);
  });

  it("honours the shipped 2MB default ceiling", (): void => {
    const buffer: RollingBuffer = new RollingBuffer();

    for (let i: number = 0; i < 40; i++) {
      buffer.push(
        makeEvent({
          isCheckout: i % 4 === 0,
          bytes: 100 * 1024,
          timestampMs: i,
        }),
      );
    }

    expect(buffer.getByteSize()).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("drains in order and empties itself", (): void => {
    const buffer: RollingBuffer = new RollingBuffer();

    buffer.push(makeEvent({ isCheckout: true, json: "a" }));
    buffer.push(makeEvent({ json: "b" }));
    buffer.push(makeEvent({ isCheckout: true, json: "c" }));

    const drained: Array<BufferedEvent> = buffer.drain();

    expect(
      drained.map((event: BufferedEvent): string => {
        return event.json;
      }),
    ).toEqual(["a", "b", "c"]);
    expect(buffer.getEventCount()).toBe(0);
    expect(buffer.getByteSize()).toBe(0);
  });

  it("releases everything on clear without handing it over", (): void => {
    const buffer: RollingBuffer = new RollingBuffer();

    buffer.push(makeEvent());
    buffer.clear();

    expect(buffer.getEventCount()).toBe(0);
    expect(buffer.drain()).toEqual([]);
  });
});
