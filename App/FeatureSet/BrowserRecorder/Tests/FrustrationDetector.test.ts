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

  beforeEach((): void => {
    jest.useFakeTimers();

    signals = [];
    customEvents = [];
    document.body.innerHTML =
      "<div id='dead'>plain</div><button id='btn'>go</button>";

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

      const rage: Array<FrustrationSignal> = signals.filter(
        (signal: FrustrationSignal): boolean => {
          return signal.kind === "rage-click";
        },
      );

      expect(rage).toHaveLength(1);
      expect(rage[0]?.clickCount).toBe(3);
    });

    it("does not fire for clicks spread beyond the radius", (): void => {
      clickAt(0, 0);
      clickAt(200, 0);
      clickAt(400, 0);

      expect(
        signals.some((signal: FrustrationSignal): boolean => {
          return signal.kind === "rage-click";
        }),
      ).toBe(false);
    });

    it("does not fire for clicks spread beyond the time window", (): void => {
      clickAt(100, 100);
      jest.advanceTimersByTime(1200);
      jest.setSystemTime(Date.now() + 1200);
      clickAt(100, 100);
      jest.setSystemTime(Date.now() + 1200);
      clickAt(100, 100);

      expect(
        signals.some((signal: FrustrationSignal): boolean => {
          return signal.kind === "rage-click";
        }),
      ).toBe(false);
    });

    /* A burst of six clicks is one angry moment, not four overlapping ones. */
    it("reports one signal per cluster, not one per extra click", (): void => {
      for (let i: number = 0; i < 6; i++) {
        clickAt(100, 100);
      }

      expect(
        signals.filter((signal: FrustrationSignal): boolean => {
          return signal.kind === "rage-click";
        }),
      ).toHaveLength(1);
    });

    it("emits a type-5 custom event alongside the counter", (): void => {
      clickAt(100, 100);
      clickAt(100, 100);
      clickAt(100, 100);

      expect(customEvents[0]?.tag).toBe(FRUSTRATION_CUSTOM_EVENT_TAG);
    });
  });

  describe("dead click", (): void => {
    it("fires when nothing at all happens after a click on inert markup", (): void => {
      const dead: HTMLElement | null = document.getElementById("dead");

      clickAt(10, 10, dead as Element);

      jest.advanceTimersByTime(3100);

      expect(
        signals.filter((signal: FrustrationSignal): boolean => {
          return signal.kind === "dead-click";
        }),
      ).toHaveLength(1);
    });

    it("does not fire for a click on an interactive element", (): void => {
      const button: HTMLElement | null = document.getElementById("btn");

      clickAt(10, 10, button as Element);

      jest.advanceTimersByTime(3100);

      expect(
        signals.some((signal: FrustrationSignal): boolean => {
          return signal.kind === "dead-click";
        }),
      ).toBe(false);
    });

    it("does not fire for a click on a span inside a button", (): void => {
      document.body.innerHTML = "<button><span id='label'>go</span></button>";

      clickAt(10, 10, document.getElementById("label") as Element);

      jest.advanceTimersByTime(3100);

      expect(
        signals.some((signal: FrustrationSignal): boolean => {
          return signal.kind === "dead-click";
        }),
      ).toBe(false);
    });

    /*
     * Activity is fed in from rrweb's own mutation observer and from the
     * network wrapper, so the detector does not install a second
     * document-wide MutationObserver.
     */
    it("is cleared by a DOM mutation, a request or a navigation", (): void => {
      const dead: HTMLElement | null = document.getElementById("dead");

      clickAt(10, 10, dead as Element);
      detector.notifyActivity(Date.now() + 10);

      jest.advanceTimersByTime(3100);

      expect(
        signals.some((signal: FrustrationSignal): boolean => {
          return signal.kind === "dead-click";
        }),
      ).toBe(false);
    });

    it("is not cleared by activity that happened before the click", (): void => {
      detector.notifyActivity(Date.now() - 1000);

      clickAt(10, 10, document.getElementById("dead") as Element);

      jest.advanceTimersByTime(3100);

      expect(
        signals.filter((signal: FrustrationSignal): boolean => {
          return signal.kind === "dead-click";
        }),
      ).toHaveLength(1);
    });
  });

  describe("error click", (): void => {
    it("attributes an error within a second of a click", (): void => {
      clickAt(20, 20, document.getElementById("btn") as Element);

      detector.notifyError(Date.now() + 200);

      expect(
        signals.filter((signal: FrustrationSignal): boolean => {
          return signal.kind === "error-click";
        }),
      ).toHaveLength(1);
    });

    it("ignores an error long after the click", (): void => {
      clickAt(20, 20, document.getElementById("btn") as Element);

      detector.notifyError(Date.now() + 5000);

      expect(
        signals.some((signal: FrustrationSignal): boolean => {
          return signal.kind === "error-click";
        }),
      ).toBe(false);
    });

    /* Three rejections from one click is one error click. */
    it("consumes the click so a burst of errors reports once", (): void => {
      clickAt(20, 20, document.getElementById("btn") as Element);

      detector.notifyError(Date.now() + 10);
      detector.notifyError(Date.now() + 20);
      detector.notifyError(Date.now() + 30);

      expect(
        signals.filter((signal: FrustrationSignal): boolean => {
          return signal.kind === "error-click";
        }),
      ).toHaveLength(1);
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

  describe("isInteractive", (): void => {
    it("classifies an unknown target as interactive, to avoid false dead clicks", (): void => {
      expect(FrustrationDetector.isInteractive(null)).toBe(false);
      expect(
        FrustrationDetector.isInteractive(document.createElement("div")),
      ).toBe(false);
      expect(
        FrustrationDetector.isInteractive(document.createElement("a")),
      ).toBe(true);
    });
  });

  describe("stop", (): void => {
    it("cancels pending dead-click timers", (): void => {
      clickAt(10, 10, document.getElementById("dead") as Element);

      detector.stop(document);

      jest.advanceTimersByTime(5000);

      expect(signals).toHaveLength(0);
    });
  });
});
