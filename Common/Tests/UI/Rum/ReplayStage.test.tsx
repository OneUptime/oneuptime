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
  REPLAY_STAGE_MAX_HEIGHT_VH,
  REPLAY_STAGE_MIN_HEIGHT_REM,
  REPLAY_STAGE_THEATER_MAX_HEIGHT_VH,
  REPLAY_TEXT_SELECTION_CSS,
  computeContainScale,
  computeReplayStageHeight,
  disableReplayTextSelection,
  enableReplayTextSelection,
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

interface BoundingRectSpy {
  mockReturnValue: (value: DOMRect) => unknown;
  mockRestore: () => void;
}

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
  it("reserves the measured transport height without letting a short viewport erase the recording", () => {
    expect(computeReplayStageHeight(900, 300, 260)).toBe(340);
    expect(computeReplayStageHeight(1100, 300, 260)).toBe(540);
    expect(computeReplayStageHeight(600, 350, 260)).toBe(256);
  });

  it("recalculates desktop height when transport size changes and keeps normal sizing on mobile", () => {
    const engine: FakeEngine = new FakeEngine();
    const originalWidth: number = window.innerWidth;
    const originalHeight: number = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });

    try {
      const { rerender } = render(
        <ReplayStage
          engine={engine}
          reservedBottomHeightPx={260}
          viewportWidth={1200}
          viewportHeight={760}
        />,
      );
      expect(stageElement().style.maxHeight).toBe("640px");
      expect(stageElement().style.aspectRatio).toBe("1200 / 760");
      expect(stageElement().style.minHeight).toBe("16rem");

      rerender(
        <ReplayStage
          engine={engine}
          reservedBottomHeightPx={320}
          viewportWidth={1200}
          viewportHeight={760}
        />,
      );
      expect(stageElement().style.maxHeight).toBe("580px");

      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 390,
      });
      act((): void => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(stageElement().style.maxHeight).toBe(
        `${REPLAY_STAGE_MAX_HEIGHT_VH}vh`,
      );
      expect(stageElement().style.minHeight).toBe(
        `${REPLAY_STAGE_MIN_HEIGHT_REM}rem`,
      );
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
    }
  });

  it("refits when a header notice moves the stage without changing its own size", () => {
    const originalObserver: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(window, "ResizeObserver");
    const originalWidth: number = window.innerWidth;
    const originalHeight: number = window.innerHeight;
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
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });

    try {
      const engine: FakeEngine = new FakeEngine();
      render(
        <div data-replay-layout="true">
          <header>Recording details</header>
          <ReplayStage engine={engine} reservedBottomHeightPx={260} />
        </div>,
      );
      const stage: HTMLElement = stageElement();
      const header: HTMLElement = document.querySelector(
        "header",
      ) as HTMLElement;
      expect(observed).toContain(header);
      expect(observed).toContain(stage);
      /*
       * Named structurally rather than as jest.SpiedFunction: jest.spyOn here
       * is the one imported from @jest/globals, whose return type is
       * jest-mock's SpyInstance, while `jest.SpiedFunction` resolves through
       * the global @types/jest namespace. The two declarations do not assign
       * to each other, so name only what this test uses.
       */
      const rectangle: BoundingRectSpy = jest.spyOn(
        stage,
        "getBoundingClientRect",
      );
      rectangle.mockReturnValue({ top: 200 } as DOMRect);
      act((): void => {
        callbacks[0]?.([], instances[0] as ResizeObserver);
      });
      expect(stage.style.maxHeight).toBe("440px");

      // A clipboard fallback expands the header; no resize event is needed.
      header.textContent = "Copy the link by hand";
      rectangle.mockReturnValue({ top: 300 } as DOMRect);
      act((): void => {
        callbacks[0]?.([], instances[0] as ResizeObserver);
      });
      expect(stage.style.maxHeight).toBe("340px");
      rectangle.mockRestore();
    } finally {
      if (originalObserver) {
        Object.defineProperty(window, "ResizeObserver", originalObserver);
      } else {
        Reflect.deleteProperty(window, "ResizeObserver");
      }
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
    }
  });

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

  it("allows native selection and copy while blocking replay mutations and navigation", () => {
    const replayer: ReplayerLike & { iframe: HTMLIFrameElement } =
      makeReplayer();
    const doc: Document = replayer.iframe.contentDocument as Document;
    const win: Window & typeof globalThis = replayer.iframe
      .contentWindow as Window & typeof globalThis;

    doc.body.innerHTML = `
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

    const link: HTMLAnchorElement = doc.querySelector("a") as HTMLAnchorElement;
    const input: HTMLInputElement = doc.querySelector(
      "input",
    ) as HTMLInputElement;
    const rangeInput: HTMLInputElement = doc.querySelector(
      "#recorded-range",
    ) as HTMLInputElement;

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

    for (const type of [
      "mousedown",
      "mousemove",
      "mouseup",
      "copy",
      "contextmenu",
    ]) {
      const event: Event = new win.Event(type, {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

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
    expect(stylelessParagraph).not.toHaveAttribute("style");
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
