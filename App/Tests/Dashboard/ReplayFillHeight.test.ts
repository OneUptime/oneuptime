import { describe, expect, test } from "@jest/globals";
import {
  REPLAY_FILL_BOTTOM_GUTTER_PX,
  REPLAY_FILL_HEIGHT_CSS_VAR,
  REPLAY_FILL_MIN_HEIGHT_PX,
  ReplayFillHeightElementLike,
  ReplayFillHeightResizeObserverLike,
  ReplayFillHeightViewLike,
  computeReplayFillHeight,
  measureReplayFillHeight,
  observeReplayFillHeight,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayFillHeight";

/*
 * The height the player fills at xl and up. What is pinned: the arithmetic
 * (viewport - document top - gutter, floored, never below the minimum),
 * that a non-finite input yields the minimum rather than a NaN CSS value,
 * that the measurement uses the DOCUMENT top (so scrolling does not resize
 * the player), and that the subscription re-measures on a window resize
 * and on a ResizeObserver callback, reports only changed values, works
 * without ResizeObserver, and unsubscribes everything it attached.
 */

class FakeResizeObserver implements ReplayFillHeightResizeObserverLike {
  public static instances: Array<FakeResizeObserver> = [];
  public readonly targets: Array<Element> = [];
  public isDisconnected: boolean = false;
  private readonly callback: () => void;

  public constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  public observe(target: Element): void {
    this.targets.push(target);
  }

  public disconnect(): void {
    this.isDisconnected = true;
  }

  public fire(): void {
    this.callback();
  }
}

class FakeView implements ReplayFillHeightViewLike {
  public innerHeight: number;
  public scrollY: number;
  public readonly listeners: Array<() => void> = [];
  public readonly documentElement: Element = {
    nodeName: "HTML",
  } as unknown as Element;
  public ResizeObserver?:
    | (new (callback: () => void) => FakeResizeObserver)
    | undefined;

  public constructor(innerHeight: number, hasResizeObserver: boolean = true) {
    this.innerHeight = innerHeight;
    this.scrollY = 0;

    if (hasResizeObserver) {
      this.ResizeObserver = FakeResizeObserver;
    }
  }

  public get document(): { documentElement: Element } {
    return { documentElement: this.documentElement };
  }

  public addEventListener(_type: "resize", listener: () => void): void {
    this.listeners.push(listener);
  }

  public removeEventListener(_type: "resize", listener: () => void): void {
    const index: number = this.listeners.indexOf(listener);

    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  public resize(innerHeight: number): void {
    this.innerHeight = innerHeight;

    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

class FakeElement implements ReplayFillHeightElementLike {
  public top: number;
  public parentElement: Element | null;
  public rectReads: number = 0;

  public constructor(top: number, hasParent: boolean = true) {
    this.top = top;
    this.parentElement = hasParent
      ? ({ nodeName: "DIV" } as unknown as Element)
      : null;
  }

  public getBoundingClientRect(): { top: number } {
    this.rectReads += 1;

    return { top: this.top };
  }
}

describe("computeReplayFillHeight", () => {
  test("fills from the player's document top to the bottom gutter", () => {
    expect(
      computeReplayFillHeight({ viewportHeight: 900, rootDocumentTop: 180 }),
    ).toBe(900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX);
  });

  test("a taller viewport gives a taller player, one pixel for one pixel", () => {
    expect(
      computeReplayFillHeight({ viewportHeight: 1200, rootDocumentTop: 180 }),
    ).toBe(1200 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX);
    expect(
      computeReplayFillHeight({ viewportHeight: 901, rootDocumentTop: 180 }),
    ).toBe(
      computeReplayFillHeight({ viewportHeight: 900, rootDocumentTop: 180 }) +
        1,
    );
  });

  test("never goes below the minimum: a short window scrolls instead", () => {
    expect(
      computeReplayFillHeight({ viewportHeight: 600, rootDocumentTop: 300 }),
    ).toBe(REPLAY_FILL_MIN_HEIGHT_PX);
    expect(
      computeReplayFillHeight({ viewportHeight: 200, rootDocumentTop: 0 }),
    ).toBe(REPLAY_FILL_MIN_HEIGHT_PX);
    /* Even when the player starts below the fold. */
    expect(
      computeReplayFillHeight({ viewportHeight: 900, rootDocumentTop: 2000 }),
    ).toBe(REPLAY_FILL_MIN_HEIGHT_PX);
  });

  test("honours an explicit gutter and minimum", () => {
    expect(
      computeReplayFillHeight({
        viewportHeight: 900,
        rootDocumentTop: 100,
        bottomGutterPx: 0,
      }),
    ).toBe(800);
    expect(
      computeReplayFillHeight({
        viewportHeight: 900,
        rootDocumentTop: 100,
        bottomGutterPx: 40,
        minHeightPx: 100,
      }),
    ).toBe(760);
    expect(
      computeReplayFillHeight({
        viewportHeight: 400,
        rootDocumentTop: 100,
        minHeightPx: 320,
      }),
    ).toBe(320);
  });

  test("rounds down to a whole pixel", () => {
    expect(
      computeReplayFillHeight({
        viewportHeight: 900.75,
        rootDocumentTop: 180.5,
        bottomGutterPx: 0,
      }),
    ).toBe(720);
    expect(
      computeReplayFillHeight({
        viewportHeight: 900,
        rootDocumentTop: 0,
        bottomGutterPx: 0,
        minHeightPx: 640.9,
      }),
    ).toBe(900);
    expect(
      computeReplayFillHeight({
        viewportHeight: 100,
        rootDocumentTop: 0,
        minHeightPx: 640.9,
      }),
    ).toBe(640);
  });

  test("a non-finite input yields the minimum, never NaN in a CSS value", () => {
    expect(
      computeReplayFillHeight({ viewportHeight: NaN, rootDocumentTop: 100 }),
    ).toBe(REPLAY_FILL_MIN_HEIGHT_PX);
    expect(
      computeReplayFillHeight({ viewportHeight: 900, rootDocumentTop: NaN }),
    ).toBe(REPLAY_FILL_MIN_HEIGHT_PX);
    expect(
      computeReplayFillHeight({
        viewportHeight: Number.POSITIVE_INFINITY,
        rootDocumentTop: 0,
      }),
    ).toBe(REPLAY_FILL_MIN_HEIGHT_PX);
    expect(
      computeReplayFillHeight({
        viewportHeight: 900,
        rootDocumentTop: 100,
        bottomGutterPx: NaN,
        minHeightPx: NaN,
      }),
    ).toBe(900 - 100 - REPLAY_FILL_BOTTOM_GUTTER_PX);
  });

  test("the CSS variable name is the one the shell writes", () => {
    expect(REPLAY_FILL_HEIGHT_CSS_VAR).toBe("--oneuptime-replay-fill-height");
    expect(REPLAY_FILL_HEIGHT_CSS_VAR.startsWith("--")).toBe(true);
    expect(REPLAY_FILL_MIN_HEIGHT_PX).toBe(600);
    expect(REPLAY_FILL_BOTTOM_GUTTER_PX).toBe(16);
  });
});

describe("measureReplayFillHeight", () => {
  test("adds the scroll offset so the document top, not the viewport top, is used", () => {
    const view: FakeView = new FakeView(900);
    const element: FakeElement = new FakeElement(180);

    expect(measureReplayFillHeight(element, view)).toBe(
      900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
    );

    /* Scrolled 100px down: the element's viewport top moved up by 100. */
    view.scrollY = 100;
    element.top = 80;

    expect(measureReplayFillHeight(element, view)).toBe(
      900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
    );
  });

  test("a missing or non-finite scrollY is treated as the top of the document", () => {
    const view: FakeView = new FakeView(900);

    view.scrollY = NaN;

    expect(measureReplayFillHeight(new FakeElement(180), view)).toBe(
      900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
    );
  });

  test("an element whose rect throws falls back to the minimum", () => {
    const view: FakeView = new FakeView(900);
    const broken: ReplayFillHeightElementLike = {
      getBoundingClientRect: (): { top: number } => {
        throw new Error("detached");
      },
    };

    expect(measureReplayFillHeight(broken, view)).toBe(
      REPLAY_FILL_MIN_HEIGHT_PX,
    );
  });
});

describe("observeReplayFillHeight", () => {
  function collect(): {
    heights: Array<number>;
    onChange: (height: number) => void;
  } {
    const heights: Array<number> = [];

    return {
      heights: heights,
      onChange: (height: number): void => {
        heights.push(height);
      },
    };
  }

  test("measures once immediately", () => {
    FakeResizeObserver.instances = [];

    const view: FakeView = new FakeView(900);
    const sink: {
      heights: Array<number>;
      onChange: (height: number) => void;
    } = collect();

    const dispose: () => void = observeReplayFillHeight({
      element: new FakeElement(180),
      view: view,
      onChange: sink.onChange,
    });

    expect(sink.heights).toEqual([900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX]);
    dispose();
  });

  test("re-measures on a window resize and reports only new values", () => {
    FakeResizeObserver.instances = [];

    const view: FakeView = new FakeView(900);
    const element: FakeElement = new FakeElement(180);
    const sink: {
      heights: Array<number>;
      onChange: (height: number) => void;
    } = collect();

    const dispose: () => void = observeReplayFillHeight({
      element: element,
      view: view,
      onChange: sink.onChange,
    });

    view.resize(1000);
    /* The same height again: the subscriber is not told twice. */
    view.resize(1000);

    expect(sink.heights).toEqual([
      900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
      1000 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
    ]);

    dispose();
  });

  test("observes the document element and the player's parent, and re-measures when they resize", () => {
    FakeResizeObserver.instances = [];

    const view: FakeView = new FakeView(900);
    const element: FakeElement = new FakeElement(180);
    const sink: {
      heights: Array<number>;
      onChange: (height: number) => void;
    } = collect();

    const dispose: () => void = observeReplayFillHeight({
      element: element,
      view: view,
      onChange: sink.onChange,
    });

    const observer: FakeResizeObserver = FakeResizeObserver
      .instances[0] as FakeResizeObserver;

    expect(observer.targets).toEqual([
      view.documentElement,
      element.parentElement,
    ]);

    /* A banner above the player appears: no window resize, but the top moved. */
    element.top = 260;
    observer.fire();

    expect(sink.heights).toEqual([
      900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
      900 - 260 - REPLAY_FILL_BOTTOM_GUTTER_PX,
    ]);

    /* The player's own growth does not move its top: measured, not reported. */
    observer.fire();
    expect(sink.heights).toHaveLength(2);

    dispose();
  });

  test("works without ResizeObserver: the resize listener still keeps it current", () => {
    FakeResizeObserver.instances = [];

    const view: FakeView = new FakeView(900, false);
    const sink: {
      heights: Array<number>;
      onChange: (height: number) => void;
    } = collect();

    const dispose: () => void = observeReplayFillHeight({
      element: new FakeElement(180),
      view: view,
      onChange: sink.onChange,
    });

    expect(FakeResizeObserver.instances).toHaveLength(0);

    view.resize(700);

    expect(sink.heights).toEqual([
      900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
      REPLAY_FILL_MIN_HEIGHT_PX,
    ]);

    dispose();
  });

  test("an element without a parent still observes the document element", () => {
    FakeResizeObserver.instances = [];

    const view: FakeView = new FakeView(900);
    const dispose: () => void = observeReplayFillHeight({
      element: new FakeElement(180, false),
      view: view,
      onChange: (): void => {},
    });

    expect(
      (FakeResizeObserver.instances[0] as FakeResizeObserver).targets,
    ).toEqual([view.documentElement]);

    dispose();
  });

  test("a ResizeObserver that throws on construction does not break the subscription", () => {
    const view: FakeView = new FakeView(900);

    view.ResizeObserver = class ThrowingObserver {
      public constructor() {
        throw new Error("no observers here");
      }
    } as unknown as new (callback: () => void) => FakeResizeObserver;

    const sink: {
      heights: Array<number>;
      onChange: (height: number) => void;
    } = collect();

    const dispose: () => void = observeReplayFillHeight({
      element: new FakeElement(180),
      view: view,
      onChange: sink.onChange,
    });

    view.resize(1000);

    expect(sink.heights).toEqual([
      900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
      1000 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX,
    ]);

    dispose();
  });

  test("dispose removes the listener, disconnects the observer and stops reporting", () => {
    FakeResizeObserver.instances = [];

    const view: FakeView = new FakeView(900);
    const element: FakeElement = new FakeElement(180);
    const sink: {
      heights: Array<number>;
      onChange: (height: number) => void;
    } = collect();

    const dispose: () => void = observeReplayFillHeight({
      element: element,
      view: view,
      onChange: sink.onChange,
    });

    const observer: FakeResizeObserver = FakeResizeObserver
      .instances[0] as FakeResizeObserver;

    dispose();

    expect(view.listeners).toHaveLength(0);
    expect(observer.isDisconnected).toBe(true);

    /* A late callback from an observer that already fired changes nothing. */
    element.top = 400;
    observer.fire();
    view.resize(500);

    expect(sink.heights).toEqual([900 - 180 - REPLAY_FILL_BOTTOM_GUTTER_PX]);
  });
});
