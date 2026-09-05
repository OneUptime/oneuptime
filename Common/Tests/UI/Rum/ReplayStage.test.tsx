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
import ReplayStage, {
  REPLAY_DOCUMENT_CSP,
  REPLAY_STAGE_MAX_HEIGHT_VH,
  REPLAY_STAGE_MIN_HEIGHT_REM,
  REPLAY_STAGE_THEATER_MAX_HEIGHT_VH,
  computeContainScale,
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
 * here is what needs a DOM - mounting the engine's host, contain-fit
 * scaling within the height bounds, the aspect reserved before the first
 * frame, the CSP meta on every rebuilt document, the phone frame, the
 * touch ring and the speed-aware cursor.
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
});

describe("ReplayStage sizing", () => {
  it("reserves the recorded aspect from the header viewport before the first frame", () => {
    const engine: FakeEngine = new FakeEngine();

    render(
      <ReplayStage engine={engine} viewportWidth={1440} viewportHeight={900} />,
    );

    const stage: HTMLElement = stageElement();

    expect(stage.style.aspectRatio).toBe("1440 / 900");
    expect(stage.style.minHeight).toBe(`${REPLAY_STAGE_MIN_HEIGHT_REM}rem`);
    expect(stage.style.maxHeight).toBe(`${REPLAY_STAGE_MAX_HEIGHT_VH}vh`);
  });

  it("raises the height bound to the whole viewport in theater", () => {
    const engine: FakeEngine = new FakeEngine();

    render(<ReplayStage engine={engine} isTheater={true} />);

    expect(stageElement().style.maxHeight).toBe(
      `${REPLAY_STAGE_THEATER_MAX_HEIGHT_VH}vh`,
    );
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

    expect(frame.style.width).toBe("400px");
    expect(frame.style.height).toBe("300px");
    /* Letterboxed: (600 - 400) / 2. */
    expect(frame.style.left).toBe("100px");
    expect(frame.style.top).toBe("0px");
    expect(scales[scales.length - 1]).toBeCloseTo(expected, 6);
  });

  it("scales a small recording UP rather than leaving it postage-stamped", () => {
    expect(
      computeContainScale(1500, 900, { width: 375, height: 812 }),
    ).toBeCloseTo(900 / 812, 6);
  });

  it("keeps the picture at 1:1 while the box is unmeasured", () => {
    expect(computeContainScale(0, 0, { width: 1200, height: 900 })).toBe(1);
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
  });
});

describe("ReplayStage replay document", () => {
  it("injects the CSP and referrer metas and names the iframe on every rebuilt document", () => {
    const engine: FakeEngine = new FakeEngine();
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();

    render(<ReplayStage engine={engine} />);

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
    expect(frameElement().className).toContain("ring-8");
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

    expect(ring).not.toBeNull();
    expect(ring?.style.left).toBe("50px");
    expect(ring?.style.top).toBe("100px");

    act((): void => {
      jest.advanceTimersByTime(800);
    });

    expect(
      document.querySelector('[data-testid="replay-touch-ring"]'),
    ).toBeNull();
  });
});

describe("ReplayStage cursor", () => {
  it("shortens the cursor transition with the playback speed", () => {
    const engine: FakeEngine = new FakeEngine({ speed: 4 });

    render(<ReplayStage engine={engine} />);

    expect(
      stageElement().style.getPropertyValue("--oneuptime-replay-cursor-ms"),
    ).toBe("20ms");

    act((): void => {
      engine.update({ speed: 0.5 });
    });

    expect(
      stageElement().style.getPropertyValue("--oneuptime-replay-cursor-ms"),
    ).toBe("160ms");
  });
});
