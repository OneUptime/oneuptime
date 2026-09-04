import FrustrationDetector, {
  FRUSTRATION_CUSTOM_EVENT_TAG,
  FrustrationSignal,
} from "../src/FrustrationDetector";

describe("FrustrationDetector", (): void => {
  let signals: Array<FrustrationSignal> = [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let detector: FrustrationDetector;

  const clickAt: (x: number, y: number, target?: Element) => void = (
    x: number,
    y: number,
    target?: Element,
  ): void => {
    const event: MouseEvent = new MouseEvent("click", {
      bubbles: true,
      clientX: x,
      clientY: y,
    });

    (target || document.body).dispatchEvent(event);
  };

  const ofKind: (
    kind: FrustrationSignal["kind"],
  ) => Array<FrustrationSignal> = (
    kind: FrustrationSignal["kind"],
  ): Array<FrustrationSignal> => {
    return signals.filter((signal: FrustrationSignal): boolean => {
      return signal.kind === kind;
    });
  };

  /* A rage cluster closes one window after its last click. */
  const closeRageWindow: () => void = (): void => {
    jest.advanceTimersByTime(1100);
  };

  beforeEach((): void => {
    jest.useFakeTimers();

    signals = [];
    customEvents = [];
    document.body.innerHTML = `
      <div id='plain'>plain text</div>
      <div id='pointer' style='cursor: pointer'>looks clickable</div>
      <div id='handler' onclick='void 0'>has a handler</div>
      <div id='widget' role='button'><span id='widget-label'>custom button</span></div>
      <button id='btn'>go</button>
    `;

    detector = new FrustrationDetector({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      onSignal: (signal: FrustrationSignal): void => {
        signals.push(signal);
      },
    });

    detector.start(document);
  });

  afterEach((): void => {
    detector.stop(document);
    jest.useRealTimers();
  });

  describe("rage click", (): void => {
    it("fires on three clicks inside the radius and the window", (): void => {
      clickAt(100, 100);
      clickAt(105, 102);
      clickAt(110, 108);

      closeRageWindow();

      const rage: Array<FrustrationSignal> = ofKind("rage-click");

      expect(rage).toHaveLength(1);
      expect(rage[0]?.clickCount).toBe(3);
      expect(rage[0]?.x).toBe(100);
      expect(rage[0]?.y).toBe(100);
    });

    it("does not fire for clicks spread beyond the radius", (): void => {
      clickAt(0, 0);
      clickAt(200, 0);
      clickAt(400, 0);

      closeRageWindow();

      expect(ofKind("rage-click")).toHaveLength(0);
    });

    it("does not fire for clicks spread beyond the time window", (): void => {
      clickAt(100, 100);
      jest.advanceTimersByTime(1200);
      clickAt(100, 100);
      jest.advanceTimersByTime(1200);
      clickAt(100, 100);

      closeRageWindow();

      expect(ofKind("rage-click")).toHaveLength(0);
    });

    /* A burst of six clicks is one angry moment, not four overlapping ones. */
    it("reports one signal per cluster, not one per extra click", (): void => {
      for (let i: number = 0; i < 6; i++) {
        clickAt(100, 100);
      }

      closeRageWindow();

      expect(ofKind("rage-click")).toHaveLength(1);
    });

    /*
     * The first version reported on the third click and dropped the rest,
     * so a ten-click burst was always "3 clicks". The cluster stays open
     * while clicks keep landing and reports its real size when they stop.
     */
    it("reports the real size of the burst", (): void => {
      for (let i: number = 0; i < 10; i++) {
        clickAt(100, 100);
        jest.advanceTimersByTime(50);
      }

      /* Still open: nothing reported until the clicking stops. */
      expect(ofKind("rage-click")).toHaveLength(0);

      closeRageWindow();

      const rage: Array<FrustrationSignal> = ofKind("rage-click");

      expect(rage).toHaveLength(1);
      expect(rage[0]?.clickCount).toBe(10);
    });

    it("reports a sustained rage as one cluster, timed from its first click", (): void => {
      const startedAt: number = Date.now();

      /* Thirty clicks over nine seconds, never more than 300 ms apart. */
      for (let i: number = 0; i < 30; i++) {
        clickAt(100, 100);
        jest.advanceTimersByTime(300);
      }

      closeRageWindow();

      const rage: Array<FrustrationSignal> = ofKind("rage-click");

      expect(rage).toHaveLength(1);
      expect(rage[0]?.clickCount).toBe(30);
      expect(rage[0]?.atUnixMs).toBe(startedAt);
    });

    it("starts a new cluster when the clicking moves elsewhere", (): void => {
      for (let i: number = 0; i < 4; i++) {
        clickAt(100, 100);
      }

      for (let i: number = 0; i < 3; i++) {
        clickAt(500, 500);
      }

      closeRageWindow();

      const rage: Array<FrustrationSignal> = ofKind("rage-click");

      expect(rage).toHaveLength(2);
      expect(rage[0]?.clickCount).toBe(4);
      expect(rage[1]?.clickCount).toBe(3);
    });

    it("emits a type-5 custom event alongside the counter", (): void => {
      clickAt(100, 100);
      clickAt(100, 100);
      clickAt(100, 100);

      closeRageWindow();

      expect(customEvents[0]?.tag).toBe(FRUSTRATION_CUSTOM_EVENT_TAG);
    });

    it("reports an open cluster when recording stops", (): void => {
      for (let i: number = 0; i < 5; i++) {
        clickAt(100, 100);
      }

      detector.stop(document);

      expect(ofKind("rage-click")).toHaveLength(1);
      expect(ofKind("rage-click")[0]?.clickCount).toBe(5);
    });
  });

  describe("dead click", (): void => {
    const element: (id: string) => Element = (id: string): Element => {
      return document.getElementById(id) as Element;
    };

    /*
     * The candidates: things that LOOK clickable without being native
     * controls. A custom component whose handler does nothing visible.
     */
    it("fires when nothing happens after a click on a pointer-cursor element", (): void => {
      clickAt(10, 10, element("pointer"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(1);
      expect(ofKind("dead-click")[0]?.x).toBe(10);
    });

    it("fires for an element with an onclick attribute", (): void => {
      clickAt(10, 10, element("handler"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(1);
    });

    it("fires for a widget role, including a click on its inner text", (): void => {
      clickAt(10, 10, element("widget-label"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(1);
    });

    /*
     * Plain markup is NOT a candidate. Users click on text all the time -
     * to select it, to focus the page, by accident - and reporting each one
     * made deadClickCount noise on every component-based app.
     */
    it("does not fire for a click on plain inert markup", (): void => {
      clickAt(10, 10, element("plain"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(0);
    });

    it("does not fire for a click on a native control", (): void => {
      clickAt(10, 10, element("btn"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(0);
    });

    it("does not fire for a click on a span inside a button", (): void => {
      document.body.innerHTML =
        "<button style='cursor:pointer'><span id='label'>go</span></button>";

      clickAt(10, 10, element("label"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(0);
    });

    /*
     * Activity is fed in from rrweb's own mutation observer and from the
     * network wrapper, so the detector does not install a second
     * document-wide MutationObserver.
     */
    it("is cleared by a DOM mutation, a request or a navigation", (): void => {
      clickAt(10, 10, element("pointer"));
      detector.notifyActivity(Date.now() + 10);

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(0);
    });

    /*
     * rrweb stamps a mutation batch with Date.now() and delivers it as a
     * microtask right behind the click handler, so a synchronous DOM update
     * routinely carries the SAME millisecond as the click. The old strict
     * comparison reported every one of those as dead.
     */
    it("is cleared by activity in the same millisecond as the click", (): void => {
      clickAt(10, 10, element("pointer"));
      detector.notifyActivity(Date.now());

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(0);
    });

    it("is not cleared by activity that happened before the click", (): void => {
      detector.notifyActivity(Date.now() - 1000);

      clickAt(10, 10, element("pointer"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(1);
    });

    /* A click that scrolls the page, or opens a new window, did something. */
    it("is cleared by a scroll or by the window losing focus", (): void => {
      clickAt(10, 10, element("pointer"));
      jest.advanceTimersByTime(5);
      document.dispatchEvent(new Event("scroll"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(0);

      clickAt(10, 10, element("pointer"));
      jest.advanceTimersByTime(5);
      window.dispatchEvent(new Event("blur"));

      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(0);
    });
  });

  describe("error click", (): void => {
    it("attributes an error within a second of a click, with the click's coordinates", (): void => {
      clickAt(20, 30, document.getElementById("btn") as Element);

      detector.notifyError(Date.now() + 200);

      const errorClicks: Array<FrustrationSignal> = ofKind("error-click");

      expect(errorClicks).toHaveLength(1);
      expect(errorClicks[0]?.x).toBe(20);
      expect(errorClicks[0]?.y).toBe(30);
    });

    it("ignores an error long after the click", (): void => {
      clickAt(20, 20, document.getElementById("btn") as Element);

      detector.notifyError(Date.now() + 5000);

      expect(ofKind("error-click")).toHaveLength(0);
    });

    /* Three rejections from one click is one error click. */
    it("consumes the click so a burst of errors reports once", (): void => {
      clickAt(20, 20, document.getElementById("btn") as Element);

      detector.notifyError(Date.now() + 10);
      detector.notifyError(Date.now() + 20);
      detector.notifyError(Date.now() + 30);

      expect(ofKind("error-click")).toHaveLength(1);
    });

    it("ignores an error with no preceding click", (): void => {
      detector.notifyError(Date.now());

      expect(signals).toHaveLength(0);
    });
  });

  describe("refresh rage", (): void => {
    it("reports through the same path as the click signals", (): void => {
      detector.reportRefreshRage(4, Date.now());

      expect(signals[0]?.kind).toBe("refresh-rage");
      expect(signals[0]?.reloadCount).toBe(4);
      expect(customEvents[0]?.tag).toBe(FRUSTRATION_CUSTOM_EVENT_TAG);
    });
  });

  describe("classification", (): void => {
    it("treats native controls as interactive and plain markup as not", (): void => {
      expect(FrustrationDetector.isInteractive(null)).toBe(false);
      expect(
        FrustrationDetector.isInteractive(document.createElement("div")),
      ).toBe(false);
      expect(
        FrustrationDetector.isInteractive(document.createElement("a")),
      ).toBe(true);
    });

    it("recognises what looks clickable without being a native control", (): void => {
      expect(FrustrationDetector.looksClickable(null)).toBe(false);
      expect(
        FrustrationDetector.looksClickable(document.getElementById("plain")),
      ).toBe(false);
      expect(
        FrustrationDetector.looksClickable(document.getElementById("pointer")),
      ).toBe(true);
      expect(
        FrustrationDetector.looksClickable(document.getElementById("handler")),
      ).toBe(true);
      expect(
        FrustrationDetector.looksClickable(
          document.getElementById("widget-label"),
        ),
      ).toBe(true);
    });
  });

  describe("stop", (): void => {
    it("cancels pending dead-click timers", (): void => {
      clickAt(10, 10, document.getElementById("pointer") as Element);

      detector.stop(document);

      jest.advanceTimersByTime(5000);

      expect(signals).toHaveLength(0);
    });
  });
});
