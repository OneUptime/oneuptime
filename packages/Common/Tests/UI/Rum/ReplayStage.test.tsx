import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react, so a component imported from there
 * would otherwise call hooks on a DIFFERENT React instance than the one
 * react-dom renders with, and every useRef throws "Cannot read properties of
 * null".
 *
 * That is resolved in Common's jest moduleNameMapper, which pins react and
 * react-dom to this project's single copy for every importer.
 */
import * as React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ReplayStage, {
  REPLAY_DOCUMENT_CSP,
  REPLAY_STAGE_ASPECT_CSS_VAR,
  REPLAY_STAGE_FILL_BOX_CLASS,
  REPLAY_STAGE_FIT_OVERFLOW_CLASS,
  REPLAY_STAGE_FLOW_MAX_HEIGHT_VH,
  REPLAY_STAGE_FLOW_MIN_HEIGHT_REM,
  REPLAY_STAGE_PHONE_RING_PX,
  REPLAY_STAGE_RESPONSIVE_BOX_CLASS,
  REPLAY_TEXT_SELECTION_CSS,
  ReplayStageFit,
  ReplayStageFrameGeometry,
  computeContainScale,
  computeReplayStageFrameGeometry,
  computeWidthScale,
  disableReplayTextSelection,
  enableReplayTextSelection,
  formatReplayStageAspect,
  getReplayStageBoxClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayStage";
import {
  ReplayEngine,
  ReplayEngineDiagnostics,
  ReplayEngineEvent,
  ReplayEngineListener,
  ReplayEngineReplayerEvent,
  ReplayEngineReplayerListener,
  ReplayEngineSnapshot,
  ReplayerLike,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";

/*
 * ReplayStage is now a thin React binding over the engine: everything
 * about WHAT plays is pinned in ReplayEngine.test.ts. What is left to pin
 * here is what needs a DOM - mounting the engine's host, the box classes
 * that take the leftover height from the player's flex column, the three
 * fits and their frame geometry, the aspect reserved before the first
 * frame, the CSP meta on every rebuilt document, the phone frame, the
 * touch ring and the speed-aware cursor.
 *
 * The stage no longer measures the viewport, the page offset or the
 * transport: its height comes from CSS, so the only measurement left is
 * its own box.
 */

function makeSnapshot(
  overrides?: Partial<ReplayEngineSnapshot>,
): ReplayEngineSnapshot {
  return {
    phase: "paused",
    intent: "paused",
    buffer: "ok",
    currentTimeMs: 0,
    durationMs: 60000,
    speed: 1,
    skipInactive: false,
    fedRange: null,
    loadedChunkIndexes: [],
    activeTabId: "tab-1",
    recordedSize: null,
    bufferingSinceMs: null,
    lastGap: null,
    lastIdleSkip: null,
    error: null,
    pendingSeekMs: null,
    generation: 0,
    notice: null,
    idleBands: [],
    feedAheadMs: 30000,
    earliestPlayableMs: 0,
    ...overrides,
  };
}

/* The engine as the stage sees it: a store, a host element and a hook. */
class FakeEngine implements ReplayEngine {
  public snapshotValue: ReplayEngineSnapshot;
  public readonly host: HTMLElement;
  public attachedTo: HTMLElement | null = null;
  public detachCount: number = 0;
  public readonly dispatched: Array<ReplayEngineEvent> = [];
  private readonly listeners: Set<ReplayEngineListener> =
    new Set<ReplayEngineListener>();
  private readonly replayerListeners: Set<ReplayEngineReplayerListener> =
    new Set<ReplayEngineReplayerListener>();

  public constructor(snapshot?: Partial<ReplayEngineSnapshot>) {
    this.snapshotValue = makeSnapshot(snapshot);
    this.host = document.createElement("div");
    this.host.className = "oneuptime-replay-host";
  }

  public dispatch(event: ReplayEngineEvent): void {
    this.dispatched.push(event);
  }

  public subscribe(listener: ReplayEngineListener): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): ReplayEngineSnapshot {
    return this.snapshotValue;
  }

  public attach(container: HTMLElement): void {
    this.attachedTo = container;
    container.appendChild(this.host);
  }

  public detach(): void {
    this.detachCount += 1;
    this.host.parentElement?.removeChild(this.host);
    this.attachedTo = null;
  }

  public dispose(): void {
    this.detach();
  }

  public onReplayer(listener: ReplayEngineReplayerListener): () => void {
    this.replayerListeners.add(listener);

    return (): void => {
      this.replayerListeners.delete(listener);
    };
  }

  public getHostElement(): HTMLElement | null {
    return this.host;
  }

  public getDiagnostics(): ReplayEngineDiagnostics {
    return {
      watchdogFireCount: 0,
      replayersCreated: 0,
      replayersDestroyed: 0,
      generation: 0,
      anchorChunkIndex: null,
      lastFedChunkIndex: null,
      isHoldingLastFrame: false,
      isAttached: this.attachedTo !== null,
    };
  }

  public update(patch: Partial<ReplayEngineSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch };

    for (const listener of [...this.listeners]) {
      listener(this.snapshotValue);
    }
  }

  public emitReplayer(event: ReplayEngineReplayerEvent): void {
    for (const listener of [...this.replayerListeners]) {
      listener(event);
    }
  }
}

/* A Replayer whose iframe is in the document, so it has a contentDocument. */
function makeReplayer(): ReplayerLike & { iframe: HTMLIFrameElement } {
  const iframe: HTMLIFrameElement = document.createElement("iframe");
  document.body.appendChild(iframe);

  return {
    iframe: iframe,
    wrapper: document.createElement("div"),
    play: (): void => {
      // Not exercised by the stage.
    },
    pause: (): void => {
      // Not exercised by the stage.
    },
    destroy: (): void => {
      iframe.remove();
    },
    addEvent: (): void => {
      // Not exercised by the stage.
    },
    getCurrentTime: (): number => {
      return 0;
    },
    setConfig: (): void => {
      // Not exercised by the stage.
    },
    on: (): unknown => {
      return undefined;
    },
  };
}

/* jsdom does no layout: give the stage box a size by hand. */
function sizeElement(
  element: HTMLElement,
  width: number,
  height: number,
): void {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    get: (): number => {
      return width;
    },
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: (): number => {
      return height;
    },
  });
}

function stageElement(): HTMLElement {
  const element: HTMLElement | null = document.querySelector(
    '[data-testid="replay-stage"]',
  );

  if (!element) {
    throw new Error("stage not rendered");
  }

  return element;
}

function frameElement(): HTMLElement {
  const element: HTMLElement | null = document.querySelector(
    '[data-testid="replay-stage-frame"]',
  );

  if (!element) {
    throw new Error("frame not rendered");
  }

  return element;
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  document.body.innerHTML = "";
});

describe("ReplayStage mounting", () => {
  it("attaches the engine's host into the stage on mount and detaches on unmount", () => {
    const engine: FakeEngine = new FakeEngine();

    const { unmount } = render(<ReplayStage engine={engine} />);

    expect(engine.attachedTo).not.toBeNull();
    expect(stageElement().contains(engine.host)).toBe(true);
    expect(stageElement()).toHaveAttribute("role", "region");
    expect(stageElement()).toHaveAttribute("aria-label", "Session replay");

    unmount();

    expect(engine.detachCount).toBe(1);
    expect(engine.host.parentElement).toBeNull();
  });

  it("exposes the engine phase for the E2E hooks and marks busy phases", () => {
    const engine: FakeEngine = new FakeEngine({ phase: "buffering" });

    render(<ReplayStage engine={engine} />);

    expect(stageElement()).toHaveAttribute("data-replay-phase", "buffering");
    expect(stageElement()).toHaveAttribute("aria-busy", "true");

    /* The phase word itself is announced, not only stamped as data. */
    const phase: HTMLElement | null = document.querySelector(
      '[data-testid="replay-phase"]',
    );
    expect(phase).not.toBeNull();
    expect(phase).toHaveTextContent("buffering");
    expect(phase).toHaveAttribute("aria-live", "polite");

    act((): void => {
      engine.update({ phase: "playing" });
    });

    expect(stageElement()).toHaveAttribute("data-replay-phase", "playing");
    expect(stageElement()).toHaveAttribute("aria-busy", "false");
    expect(phase).toHaveTextContent("playing");
  });

  /*
   * The Replayer's pointer and touch rings carry the largest z-index there
   * is. At 1:1 the host has no transform, so nothing else would contain
   * it, and it painted over the overlays drawn above the stage - the
   * paused Play button and the screenshot dock among them.
   */
  it("attaches the engine's host into an isolated mount, so its z-index stays inside", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1200, height: 900 },
    });

    render(<ReplayStage engine={engine} />);

    const mount: HTMLElement | null = engine.attachedTo;

    expect(mount).not.toBeNull();
    expect(mount).toHaveClass("isolate", "absolute", "inset-0");
    expect(mount?.parentElement).toBe(frameElement());
    expect(engine.host.parentElement).toBe(mount);
  });

  it("keeps the mount isolated at every fit, 1:1 included, and for a phone frame", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1200, height: 900 },
    });
    const { rerender } = render(<ReplayStage engine={engine} fit="contain" />);
    const mount: HTMLElement | null = engine.attachedTo;
    const fits: Array<ReplayStageFit> = ["width", "actual", "contain"];

    for (const fit of fits) {
      rerender(<ReplayStage engine={engine} fit={fit} />);

      expect(stageElement()).toHaveAttribute("data-replay-fit", fit);
      expect(engine.attachedTo).toBe(mount);
      expect(engine.attachedTo).toHaveClass("isolate");
    }

    rerender(<ReplayStage engine={engine} fit="actual" isMobile={true} />);

    expect(stageElement()).toHaveAttribute("data-replay-frame", "phone");
    expect(engine.attachedTo).toBe(mount);
    expect(engine.attachedTo).toHaveClass("isolate");
  });

  /*
   * The touch rings are the mount's siblings, not its children: the frame
   * that holds them both is isolated too, on a desktop and a phone frame.
   */
  it("isolates the frame, so the touch rings stay inside it as well", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1200, height: 900 },
    });
    const { rerender } = render(<ReplayStage engine={engine} />);

    expect(frameElement()).toHaveClass("isolate");

    rerender(<ReplayStage engine={engine} isMobile={true} />);

    expect(stageElement()).toHaveAttribute("data-replay-frame", "phone");
    expect(frameElement()).toHaveClass("isolate");
  });
});

/* A ResizeObserver whose callbacks this test fires by hand. */
interface FakeResizeObserver {
  observed: Array<Element>;
  trigger: () => void;
  restore: () => void;
}

function installResizeObserver(): FakeResizeObserver {
  const original: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(window, "ResizeObserver");
  const observed: Array<Element> = [];
  const callbacks: Array<ResizeObserverCallback> = [];
  const instances: Array<ResizeObserver> = [];

  class TestResizeObserver implements ResizeObserver {
    public constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
      instances.push(this);
    }
    public observe(target: Element): void {
      observed.push(target);
    }
    public unobserve(): void {
      return;
    }
    public disconnect(): void {
      return;
    }
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: TestResizeObserver,
  });

  return {
    observed: observed,
    trigger: (): void => {
      act((): void => {
        for (let index: number = 0; index < callbacks.length; index++) {
          callbacks[index]?.([], instances[index] as ResizeObserver);
        }
      });
    },
    restore: (): void => {
      if (original) {
        Object.defineProperty(window, "ResizeObserver", original);
      } else {
        Reflect.deleteProperty(window, "ResizeObserver");
      }
    },
  };
}

describe("ReplayStage sizing", () => {
  /*
   * The whole point of the redesign: the box no longer computes a pixel
   * height from the viewport minus the transport (which floored at 256px
   * and drew a 1200x760 recording at 34%). It is a flex child that takes
   * whatever height the player's column has left, and below xl it falls
   * back to the recorded aspect within flow bounds.
   */
  it("takes the leftover height from the player's flex column, with flow bounds below xl", () => {
    const engine: FakeEngine = new FakeEngine();

    render(
      <ReplayStage engine={engine} viewportWidth={1200} viewportHeight={760} />,
    );

    const stage: HTMLElement = stageElement();

    expect(stage).toHaveAttribute("data-replay-sizing", "responsive");
    /* Flow (below xl): the recorded aspect, capped and floored. */
    expect(stage.className).toContain(
      "[aspect-ratio:var(--oneuptime-replay-aspect)]",
    );
    expect(stage.className).toContain(
      `max-h-[${REPLAY_STAGE_FLOW_MAX_HEIGHT_VH}vh]`,
    );
    expect(stage.className).toContain(
      `min-h-[${REPLAY_STAGE_FLOW_MIN_HEIGHT_REM}rem]`,
    );
    /* Fill (xl and up): the column's leftover height, no aspect, no cap. */
    expect(stage.className).toContain("xl:flex-1");
    expect(stage.className).toContain("xl:h-full");
    expect(stage.className).toContain("xl:min-h-0");
    expect(stage.className).toContain("xl:max-h-none");
    expect(stage.className).toContain("xl:[aspect-ratio:auto]");

    /* No measured pixel height, and no aspect-ratio style, is left. */
    expect(stage.style.maxHeight).toBe("");
    expect(stage.style.minHeight).toBe("");
    expect(stage.style.getPropertyValue("aspect-ratio")).toBe("");
    expect(stage.style.getPropertyValue(REPLAY_STAGE_ASPECT_CSS_VAR)).toBe(
      "1200 / 760",
    );
  });

  it("fills its container at every width when the shell asks for fill sizing", () => {
    const engine: FakeEngine = new FakeEngine();

    render(<ReplayStage engine={engine} sizing="fill" />);

    const stage: HTMLElement = stageElement();

    expect(stage).toHaveAttribute("data-replay-sizing", "fill");
    expect(stage.className).toContain(REPLAY_STAGE_FILL_BOX_CLASS);
    expect(stage.className).toContain("h-full");
    expect(stage.className).toContain("min-h-0");
    expect(stage.className).toContain("flex-1");
    /* Nothing caps it: theater is a definite-height page of its own. */
    expect(stage.className).not.toContain(
      `max-h-[${REPLAY_STAGE_FLOW_MAX_HEIGHT_VH}vh]`,
    );
    expect(stage.className).not.toContain("aspect-ratio");
  });

  it("still fills the screen in theater when the caller has not moved to sizing yet", () => {
    const engine: FakeEngine = new FakeEngine();

    const { rerender } = render(
      <ReplayStage engine={engine} isTheater={true} />,
    );

    expect(stageElement()).toHaveAttribute("data-replay-sizing", "fill");
    expect(stageElement().className).toContain(REPLAY_STAGE_FILL_BOX_CLASS);

    /* An explicit sizing always wins over the legacy flag. */
    rerender(
      <ReplayStage engine={engine} isTheater={true} sizing="responsive" />,
    );

    expect(stageElement()).toHaveAttribute("data-replay-sizing", "responsive");
  });

  it("spells the exported flow bounds and aspect variable out in the box classes", () => {
    /*
     * Tailwind only sees whole class names in the source, so the classes
     * are literals. These assertions are what keeps the literals and the
     * constants the shell's placeholder reuses from drifting apart.
     */
    expect(REPLAY_STAGE_RESPONSIVE_BOX_CLASS).toContain(
      `max-h-[${REPLAY_STAGE_FLOW_MAX_HEIGHT_VH}vh]`,
    );
    expect(REPLAY_STAGE_RESPONSIVE_BOX_CLASS).toContain(
      `min-h-[${REPLAY_STAGE_FLOW_MIN_HEIGHT_REM}rem]`,
    );
    expect(REPLAY_STAGE_RESPONSIVE_BOX_CLASS).toContain(
      `[aspect-ratio:var(${REPLAY_STAGE_ASPECT_CSS_VAR})]`,
    );
    expect(getReplayStageBoxClassName("responsive", "contain")).toBe(
      `${REPLAY_STAGE_RESPONSIVE_BOX_CLASS} ${REPLAY_STAGE_FIT_OVERFLOW_CLASS.contain}`,
    );
    expect(getReplayStageBoxClassName("fill", "actual")).toBe(
      `${REPLAY_STAGE_FILL_BOX_CLASS} ${REPLAY_STAGE_FIT_OVERFLOW_CLASS.actual}`,
    );
  });

  it("scrolls according to the fit, with a reserved gutter under width fit", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1200, height: 900 },
    });

    const { rerender } = render(<ReplayStage engine={engine} />);

    expect(stageElement().className).toContain("overflow-hidden");

    rerender(<ReplayStage engine={engine} fit="width" />);

    expect(stageElement()).toHaveAttribute("data-replay-fit", "width");
    expect(stageElement().className).toContain("overflow-y-auto");
    expect(stageElement().className).toContain("overflow-x-hidden");
    /*
     * Without a stable gutter the scrollbar narrows the box, the narrower
     * box scales the page down until it fits, the scrollbar goes away and
     * the two oscillate.
     */
    expect(stageElement().className).toContain("[scrollbar-gutter:stable]");

    rerender(<ReplayStage engine={engine} fit="actual" />);

    expect(stageElement().className).toContain("overflow-auto");
  });

  it("reserves the recorded aspect from the header viewport before the first frame", () => {
    const engine: FakeEngine = new FakeEngine();

    render(
      <ReplayStage engine={engine} viewportWidth={1440} viewportHeight={900} />,
    );

    expect(
      stageElement().style.getPropertyValue(REPLAY_STAGE_ASPECT_CSS_VAR),
    ).toBe("1440 / 900");
    /* The aspect is a variable the class reads, not an inline property. */
    expect(stageElement().style.getPropertyValue("aspect-ratio")).toBe("");
  });

  it("measures its own box only, and refits when that box changes", () => {
    const observer: FakeResizeObserver = installResizeObserver();

    try {
      const engine: FakeEngine = new FakeEngine({
        recordedSize: { width: 1200, height: 900 },
      });

      render(
        <div data-replay-layout="true">
          <header>Recording details</header>
          <ReplayStage engine={engine} />
        </div>,
      );

      const stage: HTMLElement = stageElement();

      expect(observer.observed).toContain(stage);
      /*
       * The header and the layout used to be observed to recompute a
       * viewport-derived height. The box's own height now comes from the
       * layout above it, so a header notice resizes the box itself.
       */
      expect(observer.observed).toHaveLength(1);

      sizeElement(stage, 600, 300);
      observer.trigger();

      expect(engine.host.style.transform).toBe(
        `scale(${computeContainScale(600, 300, { width: 1200, height: 900 })})`,
      );

      sizeElement(stage, 900, 600);
      observer.trigger();

      expect(engine.host.style.transform).toBe(
        `scale(${computeContainScale(900, 600, { width: 1200, height: 900 })})`,
      );
    } finally {
      observer.restore();
    }
  });

  it("contain-fits on the smaller of the two ratios and centres the picture", () => {
    /*
     * The old stage scaled on width alone, capped at 1 and anchored top
     * left: a phone recording sat postage-stamped in the corner and a
     * tall recording overflowed the box.
     */
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1200, height: 900 },
    });
    const scales: Array<number> = [];

    render(
      <ReplayStage
        engine={engine}
        onScaleChange={(scale: number): void => {
          scales.push(scale);
        }}
      />,
    );

    sizeElement(stageElement(), 600, 300);

    act((): void => {
      window.dispatchEvent(new Event("resize"));
    });

    const expected: number = computeContainScale(600, 300, {
      width: 1200,
      height: 900,
    });

    expect(expected).toBeCloseTo(1 / 3, 6);
    expect(engine.host.style.transform).toBe(`scale(${expected})`);
    expect(engine.host.style.width).toBe("1200px");
    expect(engine.host.style.height).toBe("900px");

    const frame: HTMLElement = frameElement();

    expect(frame.style.position).toBe("absolute");
    expect(frame.style.width).toBe("400px");
    expect(frame.style.height).toBe("300px");
    /* Letterboxed: (600 - 400) / 2. */
    expect(frame.style.left).toBe("100px");
    expect(frame.style.top).toBe("0px");
    expect(frame.style.margin).toBe("");
    expect(scales[scales.length - 1]).toBeCloseTo(expected, 6);
  });

  it("scales a small recording UP rather than leaving it postage-stamped", () => {
    expect(
      computeContainScale(1500, 900, { width: 375, height: 812 }),
    ).toBeCloseTo(900 / 812, 6);
  });

  it("keeps the picture at 1:1 while the box is unmeasured", () => {
    expect(computeContainScale(0, 0, { width: 1200, height: 900 })).toBe(1);
    expect(computeWidthScale(0, { width: 1200, height: 900 })).toBe(1);
  });

  it("fills the width and scrolls the page vertically when fit is width", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1200, height: 900 },
    });
    const scales: Array<number> = [];

    render(
      <ReplayStage
        engine={engine}
        fit="width"
        onScaleChange={(scale: number): void => {
          scales.push(scale);
        }}
      />,
    );

    sizeElement(stageElement(), 600, 300);

    act((): void => {
      window.dispatchEvent(new Event("resize"));
    });

    /* Width alone decides the scale; the 900px-tall page then scrolls. */
    expect(engine.host.style.transform).toBe("scale(0.5)");
    expect(scales[scales.length - 1]).toBe(0.5);

    const frame: HTMLElement = frameElement();

    /* In flow, so the box's scroll area is the frame's own height. */
    expect(frame.style.position).toBe("relative");
    expect(frame.style.left).toBe("0px");
    expect(frame.style.top).toBe("0px");
    expect(frame.style.width).toBe("600px");
    expect(frame.style.height).toBe("450px");
  });

  it("centres a short recording vertically under width fit", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1200, height: 900 },
    });

    render(<ReplayStage engine={engine} fit="width" />);

    sizeElement(stageElement(), 600, 1000);

    act((): void => {
      window.dispatchEvent(new Event("resize"));
    });

    /* 450px of picture in a 1000px box: (1000 - 450) / 2. */
    expect(frameElement().style.top).toBe("275px");
    expect(frameElement().style.height).toBe("450px");
  });

  it("keeps the phone frame's ring inside the box when contain-fitting", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 375, height: 812 },
    });

    render(<ReplayStage engine={engine} />);

    sizeElement(stageElement(), 200, 400);

    act((): void => {
      window.dispatchEvent(new Event("resize"));
    });

    const ring: number = REPLAY_STAGE_PHONE_RING_PX;
    const inset: number = computeContainScale(200 - 2 * ring, 400 - 2 * ring, {
      width: 375,
      height: 812,
    });

    expect(stageElement()).toHaveAttribute("data-replay-frame", "phone");
    /* The ring is drawn OUTSIDE the frame, so the fit reserves it. */
    expect(engine.host.style.transform).toBe(`scale(${inset})`);
    expect(inset).toBeLessThan(
      computeContainScale(200, 400, { width: 375, height: 812 }),
    );
    expect(frameElement().style.top).toBe(`${ring}px`);
    expect(
      Number.parseInt(frameElement().style.left, 10),
    ).toBeGreaterThanOrEqual(ring);
  });

  it("shows the recording at 1:1 in a scroll box when fit is actual", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1200, height: 900 },
    });

    render(<ReplayStage engine={engine} fit="actual" />);

    sizeElement(stageElement(), 600, 300);

    act((): void => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(stageElement()).toHaveAttribute("data-replay-fit", "actual");
    expect(stageElement().className).toContain("overflow-auto");
    expect(engine.host.style.transform).toBe("");
    expect(frameElement().style.width).toBe("1200px");
    expect(frameElement().style.position).toBe("relative");
    expect(frameElement().style.margin).toBe("");
  });
});

describe("computeReplayStageFrameGeometry", () => {
  const desktop: { width: number; height: number } = {
    width: 1200,
    height: 900,
  };

  it("centres a contain-fitted picture in the box and letterboxes the rest", () => {
    const geometry: ReplayStageFrameGeometry = computeReplayStageFrameGeometry({
      fit: "contain",
      box: { width: 600, height: 300 },
      recorded: desktop,
      isPhoneFrame: false,
    });

    expect(geometry.scale).toBeCloseTo(1 / 3, 6);
    expect(geometry).toMatchObject({
      position: "absolute",
      left: 100,
      top: 0,
      width: 400,
      height: 300,
      margin: 0,
    });
  });

  it("reserves the phone ring on every side of a contain-fitted phone frame", () => {
    const phone: { width: number; height: number } = {
      width: 375,
      height: 812,
    };
    const ring: number = REPLAY_STAGE_PHONE_RING_PX;
    const geometry: ReplayStageFrameGeometry = computeReplayStageFrameGeometry({
      fit: "contain",
      box: { width: 200, height: 400 },
      recorded: phone,
      isPhoneFrame: true,
    });

    expect(geometry.scale).toBeCloseTo(
      computeContainScale(200 - 2 * ring, 400 - 2 * ring, phone),
      6,
    );
    expect(geometry.top).toBe(ring);
    expect(geometry.left).toBeGreaterThanOrEqual(ring);
    expect(geometry.height).toBeLessThanOrEqual(400 - 2 * ring);
    expect(geometry.width).toBeLessThanOrEqual(200 - 2 * ring);
  });

  it("does not inset a box too small to hold the ring at all", () => {
    const geometry: ReplayStageFrameGeometry = computeReplayStageFrameGeometry({
      fit: "contain",
      box: { width: 10, height: 10 },
      recorded: { width: 375, height: 812 },
      isPhoneFrame: true,
    });

    /* Centred, but with no ring reserved: insetting would leave nothing. */
    expect(geometry.left).toBeLessThan(REPLAY_STAGE_PHONE_RING_PX);
    expect(geometry.top).toBe(0);
    expect(geometry.scale).toBeCloseTo(
      computeContainScale(10, 10, { width: 375, height: 812 }),
      6,
    );
  });

  it("scales width-fit on the width alone and lets the height overflow", () => {
    const geometry: ReplayStageFrameGeometry = computeReplayStageFrameGeometry({
      fit: "width",
      box: { width: 600, height: 300 },
      recorded: desktop,
      isPhoneFrame: false,
    });

    expect(geometry).toEqual({
      scale: 0.5,
      position: "relative",
      left: 0,
      top: 0,
      width: 600,
      height: 450,
      margin: 0,
    });
  });

  it("centres a width-fitted picture that is shorter than the box", () => {
    expect(
      computeReplayStageFrameGeometry({
        fit: "width",
        box: { width: 600, height: 1000 },
        recorded: desktop,
        isPhoneFrame: false,
      }).top,
    ).toBe(275);
  });

  it("keeps room around an in-flow phone frame so its ring is not clipped", () => {
    const ring: number = REPLAY_STAGE_PHONE_RING_PX;
    const width: ReplayStageFrameGeometry = computeReplayStageFrameGeometry({
      fit: "width",
      box: { width: 200, height: 400 },
      recorded: { width: 375, height: 812 },
      isPhoneFrame: true,
    });

    expect(width.margin).toBe(ring);
    expect(width.scale).toBeCloseTo((200 - 2 * ring) / 375, 6);
    expect(width.width).toBe(200 - 2 * ring);

    const actual: ReplayStageFrameGeometry = computeReplayStageFrameGeometry({
      fit: "actual",
      box: { width: 200, height: 400 },
      recorded: { width: 375, height: 812 },
      isPhoneFrame: true,
    });

    expect(actual).toEqual({
      scale: 1,
      position: "relative",
      left: 0,
      top: 0,
      width: 375,
      height: 812,
      margin: ring,
    });
  });

  it("draws 1:1 at the recorded size whatever the box is", () => {
    for (const box of [null, { width: 100, height: 100 }]) {
      expect(
        computeReplayStageFrameGeometry({
          fit: "actual",
          box: box,
          recorded: desktop,
          isPhoneFrame: false,
        }),
      ).toMatchObject({ scale: 1, width: 1200, height: 900, margin: 0 });
    }
  });

  it("falls back to 16 / 9 at 1:1 while nothing is known", () => {
    for (const fit of ["contain", "width", "actual"] as Array<ReplayStageFit>) {
      const geometry: ReplayStageFrameGeometry =
        computeReplayStageFrameGeometry({
          fit: fit,
          box: null,
          recorded: null,
          isPhoneFrame: false,
        });

      expect(geometry.scale).toBe(1);
      expect(geometry.width).toBe(16);
      expect(geometry.height).toBe(9);
      expect(geometry.left).toBe(0);
      expect(geometry.top).toBe(0);
    }
  });

  it("keeps a measured-as-zero box (jsdom, display:none) at 1:1", () => {
    expect(
      computeReplayStageFrameGeometry({
        fit: "contain",
        box: { width: 0, height: 0 },
        recorded: desktop,
        isPhoneFrame: false,
      }),
    ).toMatchObject({ scale: 1, width: 1200, height: 900, left: 0, top: 0 });
  });
});

describe("computeWidthScale", () => {
  it("spans the box's width, up or down", () => {
    expect(computeWidthScale(600, { width: 1200, height: 900 })).toBe(0.5);
    expect(computeWidthScale(1500, { width: 375, height: 812 })).toBe(4);
  });

  it("stays at 1:1 when either side is unknown", () => {
    expect(computeWidthScale(0, { width: 1200, height: 900 })).toBe(1);
    expect(computeWidthScale(-10, { width: 1200, height: 900 })).toBe(1);
    expect(computeWidthScale(600, { width: 0, height: 900 })).toBe(1);
  });
});

describe("formatReplayStageAspect", () => {
  it("formats the recorded size for the aspect-ratio variable", () => {
    expect(formatReplayStageAspect({ width: 1200, height: 760 })).toBe(
      "1200 / 760",
    );
  });

  it("falls back to 16 / 9 before any size is known", () => {
    expect(formatReplayStageAspect(null)).toBe("16 / 9");
    expect(formatReplayStageAspect(undefined)).toBe("16 / 9");
    expect(formatReplayStageAspect({ width: 0, height: 900 })).toBe("16 / 9");
    expect(formatReplayStageAspect({ width: 1200, height: 0 })).toBe("16 / 9");
  });
});

describe("ReplayStage replay document", () => {
  it("injects the CSP and referrer metas and names the iframe on every rebuilt document", () => {
    const engine: FakeEngine = new FakeEngine();
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();

    render(<ReplayStage engine={engine} isTextSelectionEnabled={true} />);

    act((): void => {
      engine.emitReplayer({
        type: "fullsnapshot-rebuilded",
        replayer: replayer,
      });
    });

    const head: HTMLHeadElement | undefined =
      replayer.iframe.contentDocument?.head;

    expect(head).toBeDefined();

    const csp: HTMLMetaElement | null | undefined = head?.querySelector(
      'meta[http-equiv="Content-Security-Policy"]',
    );

    expect(csp?.getAttribute("content")).toBe(REPLAY_DOCUMENT_CSP);
    expect(REPLAY_DOCUMENT_CSP).toContain("script-src 'none'");
    expect(
      head?.querySelector('meta[name="referrer"]')?.getAttribute("content"),
    ).toBe("no-referrer");
    expect(replayer.iframe.title).toBe("Recorded page");
    expect(replayer.iframe.style.pointerEvents).toBe("auto");
    expect(replayer.iframe).toHaveAttribute(
      "data-oneuptime-replay-text-selection",
      "true",
    );
    expect(
      head?.querySelector("style[data-oneuptime-replay-text-selection-style]")
        ?.textContent,
    ).toBe(REPLAY_TEXT_SELECTION_CSS);

    /* Idempotent: a second rebuild does not stack a second meta. */
    act((): void => {
      engine.emitReplayer({
        type: "fullsnapshot-rebuilded",
        replayer: replayer,
      });
    });

    expect(
      head?.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
        .length,
    ).toBe(1);
    expect(
      head?.querySelectorAll(
        "style[data-oneuptime-replay-text-selection-style]",
      ).length,
    ).toBe(1);
  });

  it("keeps rrweb inert by default and toggles selection on the current document", () => {
    const engine: FakeEngine = new FakeEngine();
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();
    const { rerender } = render(<ReplayStage engine={engine} />);
    const documentScan: SpyInstance<
      (selectors: string) => NodeListOf<Element>
    > = jest.spyOn(
      replayer.iframe.contentDocument as Document,
      "querySelectorAll",
    );

    act((): void => {
      engine.emitReplayer({ type: "created", replayer: replayer });
    });

    expect(replayer.iframe.style.pointerEvents).toBe("none");
    expect(replayer.iframe).not.toHaveAttribute(
      "data-oneuptime-replay-text-selection",
    );
    expect(documentScan).not.toHaveBeenCalled();
    documentScan.mockRestore();

    rerender(<ReplayStage engine={engine} isTextSelectionEnabled={true} />);

    expect(replayer.iframe.style.pointerEvents).toBe("auto");
    expect(replayer.iframe.contentDocument?.documentElement).toHaveAttribute(
      "data-oneuptime-replay-text-selection",
      "true",
    );

    rerender(<ReplayStage engine={engine} isTextSelectionEnabled={false} />);

    expect(replayer.iframe.style.pointerEvents).toBe("none");
    expect(
      replayer.iframe.contentDocument?.documentElement,
    ).not.toHaveAttribute("data-oneuptime-replay-text-selection");
    expect(
      replayer.iframe.contentDocument?.head.querySelector(
        "style[data-oneuptime-replay-text-selection-style]",
      ),
    ).toBeNull();
  });

  it("uses WebKit's prefixed computed selection value before adding an inline fallback", () => {
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();
    const doc: Document = replayer.iframe.contentDocument as Document;
    const win: Window & typeof globalThis = replayer.iframe
      .contentWindow as Window & typeof globalThis;
    doc.body.innerHTML = '<p id="webkit-text">Recorded text</p>';
    const paragraph: HTMLParagraphElement = doc.querySelector(
      "#webkit-text",
    ) as HTMLParagraphElement;
    const originalGetComputedStyle: typeof win.getComputedStyle =
      win.getComputedStyle.bind(win);
    const computedStyle: SpyInstance<
      (element: Element, pseudoElement?: string | null) => CSSStyleDeclaration
    > = jest
      .spyOn(win, "getComputedStyle")
      .mockImplementation(
        (
          element: Element,
          pseudoElement?: string | null,
        ): CSSStyleDeclaration => {
          const computed: CSSStyleDeclaration = originalGetComputedStyle(
            element,
            pseudoElement,
          );

          if (element === paragraph) {
            const originalGetPropertyValue: (property: string) => string =
              computed.getPropertyValue.bind(computed);
            computed.getPropertyValue = (property: string): string => {
              if (property === "user-select") {
                return "";
              }

              if (property === "-webkit-user-select") {
                return "text";
              }

              return originalGetPropertyValue(property);
            };
          }

          return computed;
        },
      );

    enableReplayTextSelection(replayer);

    expect(paragraph).not.toHaveAttribute("style");

    disableReplayTextSelection(replayer);
    computedStyle.mockRestore();
  });

  it("preserves recorded document and shadow markers that resemble its own", () => {
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();
    const doc: Document = replayer.iframe.contentDocument as Document;
    const disconnectObserver: SpyInstance<() => void> = jest.spyOn(
      (doc.defaultView as Window & typeof globalThis).MutationObserver
        .prototype,
      "disconnect",
    );
    doc.documentElement.setAttribute(
      "data-oneuptime-replay-text-selection",
      "recorded-value",
    );
    const recordedDocumentStyle: HTMLStyleElement = doc.createElement("style");
    recordedDocumentStyle.setAttribute(
      "data-oneuptime-replay-text-selection-style",
      "recorded-value",
    );
    recordedDocumentStyle.textContent = ".recorded-marker { color: red; }";
    doc.head.appendChild(recordedDocumentStyle);

    const shadowHost: HTMLDivElement = doc.createElement("div");
    const shadowRoot: ShadowRoot = shadowHost.attachShadow({ mode: "open" });
    const recordedShadowStyle: HTMLStyleElement = doc.createElement("style");
    recordedShadowStyle.setAttribute(
      "data-oneuptime-replay-shadow-text-selection-style",
      "recorded-value",
    );
    recordedShadowStyle.textContent = ".recorded-shadow { color: blue; }";
    shadowRoot.appendChild(recordedShadowStyle);
    const recordedShadowLink: HTMLAnchorElement = doc.createElement("a");
    recordedShadowLink.href = "https://example.com/shadow";
    recordedShadowLink.textContent = "Shadow link text";
    shadowRoot.appendChild(recordedShadowLink);
    doc.body.appendChild(shadowHost);

    enableReplayTextSelection(replayer);

    expect(doc.documentElement).toHaveAttribute(
      "data-oneuptime-replay-text-selection",
      "true",
    );
    expect(
      doc.head.querySelectorAll(
        "style[data-oneuptime-replay-text-selection-style]",
      ),
    ).toHaveLength(2);
    expect(
      shadowRoot.querySelectorAll(
        "style[data-oneuptime-replay-shadow-text-selection-style]",
      ),
    ).toHaveLength(2);
    expect(recordedShadowLink).toHaveAttribute("href", "javascript:void(0)");

    disableReplayTextSelection(replayer);

    expect(doc.documentElement).toHaveAttribute(
      "data-oneuptime-replay-text-selection",
      "recorded-value",
    );
    expect(recordedDocumentStyle.isConnected).toBe(true);
    expect(recordedDocumentStyle.textContent).toBe(
      ".recorded-marker { color: red; }",
    );
    expect(recordedShadowStyle.isConnected).toBe(true);
    expect(recordedShadowStyle.textContent).toBe(
      ".recorded-shadow { color: blue; }",
    );
    expect(recordedShadowLink).toHaveAttribute(
      "href",
      "https://example.com/shadow",
    );
    expect(
      doc.head.querySelectorAll(
        "style[data-oneuptime-replay-text-selection-style]",
      ),
    ).toHaveLength(1);
    expect(
      shadowRoot.querySelectorAll(
        "style[data-oneuptime-replay-shadow-text-selection-style]",
      ),
    ).toHaveLength(1);
    expect(disconnectObserver.mock.calls.length).toBeGreaterThanOrEqual(2);
    disconnectObserver.mockRestore();
  });

  it("allows native selection and copy while blocking replay mutations and navigation", () => {
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();
    const doc: Document = replayer.iframe.contentDocument as Document;
    const win: Window & typeof globalThis = replayer.iframe
      .contentWindow as Window & typeof globalThis;

    doc.body.innerHTML = `
      <style>
        a[href] { display: block; }
        a:not([href]) { display: none; }
      </style>
      <a href="https://example.com/account">Account</a>
      <form><input value="recorded value" /><button>Submit</button></form>
      <input id="invalid-type-input" type="not-a-real-type" value="selectable" />
      <input id="recorded-range" type="range" value="25" />
      <textarea id="recorded-textarea" style="resize: both !important; user-select: none !important">Recorded note</textarea>
      <audio id="recorded-audio" controls style="pointer-events: auto !important"></audio>
      <p id="recorded-paragraph" style="user-select: none !important; color: red">Recorded error message</p>
      <p id="recorded-styleless">Style-less recorded text</p>
      <div id="recorded-scroll"><span>Scrollable text</span></div>
      <div id="recorded-shadow-host"></div>
      <iframe title="Recorded child frame"></iframe>
    `;

    const nestedFrame: HTMLIFrameElement = doc.querySelector(
      "iframe",
    ) as HTMLIFrameElement;
    nestedFrame.setAttribute(
      "style",
      "pointer-events: none !important; border: 0",
    );
    const nestedDocument: Document = nestedFrame.contentDocument as Document;
    nestedDocument.body.innerHTML = '<a href="#nested">Nested text</a>';
    const shadowHost: HTMLElement = doc.querySelector(
      "#recorded-shadow-host",
    ) as HTMLElement;
    const shadowRoot: ShadowRoot = shadowHost.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>span { user-select: none !important; }</style>
      <span id="shadow-text" style="user-select: none !important">Recorded shadow text</span>
      <input id="shadow-range" type="range" value="10" />
    `;
    const scrollContainer: HTMLElement = doc.querySelector(
      "#recorded-scroll",
    ) as HTMLElement;
    scrollContainer.scrollTop = 12;
    const paragraph: HTMLParagraphElement = doc.querySelector(
      "#recorded-paragraph",
    ) as HTMLParagraphElement;
    const stylelessParagraph: HTMLParagraphElement = doc.querySelector(
      "#recorded-styleless",
    ) as HTMLParagraphElement;
    const textarea: HTMLTextAreaElement = doc.querySelector(
      "#recorded-textarea",
    ) as HTMLTextAreaElement;
    const audio: HTMLAudioElement = doc.querySelector(
      "#recorded-audio",
    ) as HTMLAudioElement;
    const shadowText: HTMLSpanElement = shadowRoot.querySelector(
      "#shadow-text",
    ) as HTMLSpanElement;
    const originalParagraphStyle: string | null =
      paragraph.getAttribute("style");
    const originalTextareaStyle: string | null = textarea.getAttribute("style");
    const originalAudioStyle: string | null = audio.getAttribute("style");
    const originalShadowStyle: string | null = shadowText.getAttribute("style");
    const originalNestedFrameStyle: string | null =
      nestedFrame.getAttribute("style");

    expect(stylelessParagraph).not.toHaveAttribute("style");

    enableReplayTextSelection(replayer);

    expect(REPLAY_TEXT_SELECTION_CSS).toContain("resize: none !important");
    expect(REPLAY_TEXT_SELECTION_CSS).toContain(
      "pointer-events: none !important",
    );
    expect(paragraph.style.getPropertyValue("user-select")).toBe("text");
    expect(paragraph.style.getPropertyPriority("user-select")).toBe(
      "important",
    );
    expect(textarea.style.getPropertyValue("resize")).toBe("none");
    expect(textarea.style.getPropertyPriority("resize")).toBe("important");
    expect(audio.style.getPropertyValue("pointer-events")).toBe("none");
    expect(audio.style.getPropertyPriority("pointer-events")).toBe("important");
    expect(shadowText.style.getPropertyValue("user-select")).toBe("text");
    expect(nestedFrame.style.getPropertyValue("pointer-events")).toBe("auto");
    expect(nestedFrame.style.getPropertyPriority("pointer-events")).toBe(
      "important",
    );

    const link: HTMLAnchorElement = doc.querySelector("a") as HTMLAnchorElement;
    const input: HTMLInputElement = doc.querySelector(
      "input",
    ) as HTMLInputElement;
    const rangeInput: HTMLInputElement = doc.querySelector(
      "#recorded-range",
    ) as HTMLInputElement;
    expect(link).toHaveAttribute("href", "javascript:void(0)");
    expect(win.getComputedStyle(link).display).toBe("block");

    for (const type of [
      "click",
      "auxclick",
      "submit",
      "beforeinput",
      "paste",
      "cut",
      "dragstart",
      "drop",
      "wheel",
      "touchmove",
    ]) {
      const event: Event = new win.Event(type, {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    for (const type of ["mousedown", "mousemove", "mouseup", "copy"]) {
      const event: Event = new win.Event(type, {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    const textContextMenu: Event = new win.Event("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    paragraph.dispatchEvent(textContextMenu);
    expect(textContextMenu.defaultPrevented).toBe(false);

    const navigationContextMenu: Event = new win.Event("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    link.dispatchEvent(navigationContextMenu);
    expect(navigationContextMenu.defaultPrevented).toBe(false);

    const edit: KeyboardEvent = new win.KeyboardEvent("keydown", {
      key: "x",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(edit);
    expect(edit.defaultPrevented).toBe(true);

    const copy: KeyboardEvent = new win.KeyboardEvent("keydown", {
      key: "c",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);

    const extend: KeyboardEvent = new win.KeyboardEvent("keydown", {
      key: "ArrowRight",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(extend);
    expect(extend.defaultPrevented).toBe(false);

    const caretMove: KeyboardEvent = new win.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(caretMove);
    expect(caretMove.defaultPrevented).toBe(false);

    const linkScroll: KeyboardEvent = new win.KeyboardEvent("keydown", {
      key: "PageDown",
      bubbles: true,
      cancelable: true,
    });
    link.dispatchEvent(linkScroll);
    expect(linkScroll.defaultPrevented).toBe(true);

    const tab: KeyboardEvent = new win.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);

    const searchEscape: KeyboardEvent = new win.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(searchEscape);
    expect(searchEscape.defaultPrevented).toBe(true);

    const mediaEnter: KeyboardEvent = new win.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    (doc.querySelector("#recorded-audio") as HTMLAudioElement).dispatchEvent(
      mediaEnter,
    );
    expect(mediaEnter.defaultPrevented).toBe(true);

    const rangePointerDown: Event = new win.Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    rangeInput.dispatchEvent(rangePointerDown);
    expect(rangePointerDown.defaultPrevented).toBe(true);

    const rangeKeyboardMutation: KeyboardEvent = new win.KeyboardEvent(
      "keydown",
      {
        key: "ArrowUp",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      },
    );
    rangeInput.dispatchEvent(rangeKeyboardMutation);
    expect(rangeKeyboardMutation.defaultPrevented).toBe(true);

    expect(
      shadowRoot.querySelector(
        "style[data-oneuptime-replay-shadow-text-selection-style]",
      )?.textContent,
    ).toContain("user-select: text !important");
    expect(
      shadowRoot.querySelector(
        "style[data-oneuptime-replay-shadow-text-selection-style]",
      )?.textContent,
    ).toContain(":host *");
    const shadowRange: HTMLInputElement = shadowRoot.querySelector(
      "#shadow-range",
    ) as HTMLInputElement;
    const shadowRangePointerDown: Event = new win.Event("pointerdown", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    shadowRange.dispatchEvent(shadowRangePointerDown);
    expect(shadowRangePointerDown.defaultPrevented).toBe(true);

    const textPointerDown: Event = new win.Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(textPointerDown);
    expect(textPointerDown.defaultPrevented).toBe(false);

    const invalidTypeInput: HTMLInputElement = doc.querySelector(
      "#invalid-type-input",
    ) as HTMLInputElement;
    expect(invalidTypeInput.type).toBe("text");
    const invalidTypePointerDown: Event = new win.Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    invalidTypeInput.dispatchEvent(invalidTypePointerDown);
    expect(invalidTypePointerDown.defaultPrevented).toBe(false);

    scrollContainer
      .querySelector("span")
      ?.dispatchEvent(
        new win.Event("pointerdown", { bubbles: true, cancelable: true }),
      );
    scrollContainer.scrollTop = 60;

    expect(nestedDocument.documentElement).toHaveAttribute(
      "data-oneuptime-replay-text-selection",
      "true",
    );
    expect(
      nestedDocument.head.querySelector(
        "style[data-oneuptime-replay-text-selection-style]",
      )?.textContent,
    ).toBe(REPLAY_TEXT_SELECTION_CSS);
    const nestedWindow: Window & typeof globalThis =
      nestedFrame.contentWindow as Window & typeof globalThis;
    const nestedClick: Event = new nestedWindow.Event("click", {
      bubbles: true,
      cancelable: true,
    });
    nestedDocument.querySelector("a")?.dispatchEvent(nestedClick);
    expect(nestedClick.defaultPrevented).toBe(true);

    const range: Range = doc.createRange();
    range.selectNodeContents(paragraph);
    win.getSelection()?.addRange(range);
    expect(win.getSelection()?.toString()).toBe("Recorded error message");

    disableReplayTextSelection(replayer);

    expect(win.getSelection()?.toString()).toBe("");
    expect(replayer.iframe.style.pointerEvents).toBe("none");
    expect(scrollContainer.scrollTop).toBe(12);
    expect(nestedDocument.documentElement).not.toHaveAttribute(
      "data-oneuptime-replay-text-selection",
    );
    expect(
      shadowRoot.querySelector(
        "style[data-oneuptime-replay-shadow-text-selection-style]",
      ),
    ).toBeNull();
    expect(paragraph.getAttribute("style")).toBe(originalParagraphStyle);
    expect(textarea.getAttribute("style")).toBe(originalTextareaStyle);
    expect(audio.getAttribute("style")).toBe(originalAudioStyle);
    expect(shadowText.getAttribute("style")).toBe(originalShadowStyle);
    expect(nestedFrame.getAttribute("style")).toBe(originalNestedFrameStyle);
    expect(stylelessParagraph).not.toHaveAttribute("style");
    expect(link).toHaveAttribute("href", "https://example.com/account");

    const clickAfterDisable: Event = new win.Event("click", {
      bubbles: true,
      cancelable: true,
    });
    link.dispatchEvent(clickAfterDisable);
    expect(clickAfterDisable.defaultPrevented).toBe(false);
  });

  it("makes opaque nested frames inert and restores them if they become same-origin", () => {
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();
    const doc: Document = replayer.iframe.contentDocument as Document;
    const win: Window & typeof globalThis = replayer.iframe
      .contentWindow as Window & typeof globalThis;
    const frame: HTMLIFrameElement = doc.createElement("iframe");
    frame.setAttribute("style", "border: 0; pointer-events: auto !important");
    frame.setAttribute("inert", "recorded");
    frame.setAttribute("tabindex", "4");
    doc.body.appendChild(frame);

    const originalStyle: string | null = frame.getAttribute("style");
    let childDocument: Document | null = null;
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      get: (): Document | null => {
        return childDocument;
      },
    });

    enableReplayTextSelection(replayer);

    expect(frame.style.getPropertyValue("pointer-events")).toBe("none");
    expect(frame.style.getPropertyPriority("pointer-events")).toBe("important");
    expect(frame).toHaveAttribute("inert");
    expect(frame).toHaveAttribute("tabindex", "-1");

    const childHost: HTMLIFrameElement = document.createElement("iframe");
    document.body.appendChild(childHost);
    childDocument = childHost.contentDocument as Document;
    childDocument.body.innerHTML = "<p>Readable child text</p>";
    frame.dispatchEvent(new win.Event("load"));

    expect(frame.style.getPropertyValue("pointer-events")).toBe("auto");
    expect(frame.style.getPropertyPriority("pointer-events")).toBe("important");
    expect(frame).not.toHaveAttribute("inert");
    expect(frame).toHaveAttribute("tabindex", "4");
    expect(childDocument.documentElement).toHaveAttribute(
      "data-oneuptime-replay-text-selection",
      "true",
    );

    disableReplayTextSelection(replayer);

    expect(frame.getAttribute("style")).toBe(originalStyle);
    expect(frame).toHaveAttribute("inert", "recorded");
    expect(frame).toHaveAttribute("tabindex", "4");
    expect(childDocument.documentElement).not.toHaveAttribute(
      "data-oneuptime-replay-text-selection",
    );
    childHost.remove();
  });

  it("reinstalls read-only guards after a full-snapshot document rebuild", () => {
    const engine: FakeEngine = new FakeEngine();
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();
    const doc: Document = replayer.iframe.contentDocument as Document;
    const win: Window & typeof globalThis = replayer.iframe
      .contentWindow as Window & typeof globalThis;

    render(<ReplayStage engine={engine} isTextSelectionEnabled={true} />);
    act((): void => {
      engine.emitReplayer({ type: "created", replayer: replayer });
    });

    doc.open();
    doc.write(
      '<!doctype html><html><head></head><body><a href="https://example.com/rebuilt">Rebuilt link</a></body></html>',
    );
    doc.close();

    act((): void => {
      engine.emitReplayer({
        type: "fullsnapshot-rebuilded",
        replayer: replayer,
      });
    });

    const rebuiltLink: HTMLAnchorElement = doc.querySelector(
      "a",
    ) as HTMLAnchorElement;
    const click: Event = new win.Event("click", {
      bubbles: true,
      cancelable: true,
    });
    rebuiltLink.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(doc.documentElement).toHaveAttribute(
      "data-oneuptime-replay-text-selection",
      "true",
    );
    expect(
      doc.head.querySelector(
        "style[data-oneuptime-replay-text-selection-style]",
      ),
    ).not.toBeNull();
  });

  it("restores an active selection surface when the stage unmounts", () => {
    const engine: FakeEngine = new FakeEngine();
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();
    const doc: Document = replayer.iframe.contentDocument as Document;
    const paragraph: HTMLParagraphElement = doc.createElement("p");
    paragraph.setAttribute("style", "user-select: none !important");
    paragraph.textContent = "Recorded text";
    doc.body.appendChild(paragraph);
    const originalStyle: string | null = paragraph.getAttribute("style");
    const { unmount } = render(
      <ReplayStage engine={engine} isTextSelectionEnabled={true} />,
    );

    act((): void => {
      engine.emitReplayer({ type: "created", replayer: replayer });
    });
    expect(replayer.iframe.style.pointerEvents).toBe("auto");
    expect(paragraph.style.getPropertyValue("user-select")).toBe("text");

    unmount();

    expect(replayer.iframe.style.pointerEvents).toBe("none");
    expect(doc.documentElement).not.toHaveAttribute(
      "data-oneuptime-replay-text-selection",
    );
    expect(paragraph.getAttribute("style")).toBe(originalStyle);
  });

  it("stops listening once unmounted", () => {
    const engine: FakeEngine = new FakeEngine();
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();

    const { unmount } = render(<ReplayStage engine={engine} />);
    unmount();

    engine.emitReplayer({ type: "created", replayer: replayer });

    expect(
      replayer.iframe.contentDocument?.head.querySelector(
        'meta[http-equiv="Content-Security-Policy"]',
      ),
    ).toBeNull();
  });
});

describe("ReplayStage device frame and touch", () => {
  it("draws the phone frame for a mobile-width recording", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 375, height: 812 },
    });

    render(<ReplayStage engine={engine} />);

    expect(stageElement()).toHaveAttribute("data-replay-frame", "phone");
    /* The reserved inset and the drawn ring are the same 8px. */
    expect(frameElement().className).toContain(
      `ring-${REPLAY_STAGE_PHONE_RING_PX}`,
    );
  });

  it("draws the plain frame for a desktop recording, and lets the prop override it", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 1440, height: 900 },
    });

    const { rerender } = render(<ReplayStage engine={engine} />);

    expect(stageElement()).toHaveAttribute("data-replay-frame", "desktop");

    rerender(<ReplayStage engine={engine} isMobile={true} />);

    expect(stageElement()).toHaveAttribute("data-replay-frame", "phone");
  });

  it("draws a touch ring where rrweb cast a TouchStart, scaled, and removes it", () => {
    jest.useFakeTimers();

    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 400, height: 800 },
    });

    render(<ReplayStage engine={engine} />);

    sizeElement(stageElement(), 200, 400);

    act((): void => {
      window.dispatchEvent(new Event("resize"));
    });

    act((): void => {
      engine.emitReplayer({ type: "touch", x: 100, y: 200 });
    });

    const ring: HTMLElement | null = document.querySelector(
      '[data-testid="replay-touch-ring"]',
    );
    /*
     * A 400px-wide recording wears the phone frame, so the contain fit
     * reserves the ring and the touch lands at THAT scale.
     */
    const scale: number = computeContainScale(
      200 - 2 * REPLAY_STAGE_PHONE_RING_PX,
      400 - 2 * REPLAY_STAGE_PHONE_RING_PX,
      { width: 400, height: 800 },
    );

    expect(ring).not.toBeNull();
    expect(ring?.style.left).toBe(`${Math.round(100 * scale)}px`);
    expect(ring?.style.top).toBe(`${Math.round(200 * scale)}px`);

    act((): void => {
      jest.advanceTimersByTime(800);
    });

    expect(
      document.querySelector('[data-testid="replay-touch-ring"]'),
    ).toBeNull();
  });

  it("places the touch ring at the width-fit scale, not the contain one", () => {
    const engine: FakeEngine = new FakeEngine({
      recordedSize: { width: 400, height: 800 },
    });

    /* isMobile=false: no phone ring to reserve, so the width is the width. */
    render(<ReplayStage engine={engine} fit="width" isMobile={false} />);

    /* Width fit draws this recording at 1:1; contain would be a quarter. */
    sizeElement(stageElement(), 400, 200);

    act((): void => {
      window.dispatchEvent(new Event("resize"));
    });

    act((): void => {
      engine.emitReplayer({ type: "touch", x: 100, y: 200 });
    });

    const ring: HTMLElement | null = document.querySelector(
      '[data-testid="replay-touch-ring"]',
    );

    expect(engine.host.style.transform).toBe("");
    expect(ring?.style.left).toBe("100px");
    expect(ring?.style.top).toBe("200px");
  });
});

describe("ReplayStage cursor", () => {
  /*
   * The transition has to be exactly one recorded sample interval long
   * at the speed being played: shorter and the pointer arrives early and
   * parks until the next sample, longer and it lags the click it caused.
   * A recording that predates the faster cadence keeps the interval it
   * was actually recorded at.
   */
  it("spans one legacy sample interval, scaled by the playback speed", () => {
    const engine: FakeEngine = new FakeEngine({ speed: 4 });

    render(<ReplayStage engine={engine} />);

    expect(
      stageElement().style.getPropertyValue("--oneuptime-replay-cursor-ms"),
    ).toBe("25ms");

    act((): void => {
      engine.update({ speed: 0.5 });
    });

    expect(
      stageElement().style.getPropertyValue("--oneuptime-replay-cursor-ms"),
    ).toBe("200ms");
  });

  it("uses the recorded cadence when the recording advertises it", () => {
    const engine: FakeEngine = new FakeEngine({ speed: 1 });

    render(
      <ReplayStage
        engine={engine}
        recorderCapabilities={["click-events", "mousemove-50ms"]}
      />,
    );

    expect(
      stageElement().style.getPropertyValue("--oneuptime-replay-cursor-ms"),
    ).toBe("50ms");

    act((): void => {
      engine.update({ speed: 0.5 });
    });

    expect(
      stageElement().style.getPropertyValue("--oneuptime-replay-cursor-ms"),
    ).toBe("100ms");
  });

  it("never falls below one frame, however fast the playback", () => {
    const engine: FakeEngine = new FakeEngine({ speed: 8 });

    render(
      <ReplayStage engine={engine} recorderCapabilities={["mousemove-50ms"]} />,
    );

    expect(
      stageElement().style.getPropertyValue("--oneuptime-replay-cursor-ms"),
    ).toBe("16ms");
  });
});
