import FrustrationDetector, {
  FrustrationDetectorRules,
  FrustrationSignal,
} from "../src/FrustrationDetector";
import SessionId from "../src/SessionId";
import {
  SessionReplayFrustrationSettings,
  getDefaultSessionReplayFrustrationSettings,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";

/*
 * The built-in signals follow the application's rules (its Frustration
 * Signals page): changed numbers move the line, a switched-off rule detects
 * nothing at all, and a click on an element a rule ignores never feeds it.
 * FrustrationDetector.test.ts pins the built-in rules themselves.
 */

function rulesWith(
  change: (settings: SessionReplayFrustrationSettings) => void,
): FrustrationDetectorRules {
  const settings: SessionReplayFrustrationSettings =
    getDefaultSessionReplayFrustrationSettings();

  change(settings);

  return {
    rageClick: settings.rageClick,
    deadClick: settings.deadClick,
    errorClick: settings.errorClick,
  };
}

describe("FrustrationDetector with the application's rules", (): void => {
  let signals: Array<FrustrationSignal> = [];
  let detector: FrustrationDetector | null = null;

  const start: (rules: FrustrationDetectorRules) => void = (
    rules: FrustrationDetectorRules,
  ): void => {
    detector = new FrustrationDetector({
      emitCustomEvent: (): void => {},
      onSignal: (signal: FrustrationSignal): void => {
        signals.push(signal);
      },
      rules: rules,
    });

    detector.start(document);
  };

  const clickAt: (x: number, y: number, target?: Element) => void = (
    x: number,
    y: number,
    target?: Element,
  ): void => {
    (target || document.body).dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
    );
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

  beforeEach((): void => {
    jest.useFakeTimers();
    signals = [];
    document.body.innerHTML = `
      <div id='widget' role='button'><span id='widget-label'>custom button</span></div>
      <div class='quantity-stepper' role='button'><span id='plus'>+</span></div>
      <div id='carousel' role='button'>next</div>
    `;
  });

  afterEach((): void => {
    if (detector) {
      detector.stop(document);
      detector = null;
    }

    jest.useRealTimers();
  });

  describe("rage clicks", (): void => {
    it("waits for the number of clicks the rule asks for", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.rageClick.clickCount = 5;
        }),
      );

      for (let click: number = 0; click < 4; click++) {
        clickAt(100, 100);
      }

      jest.advanceTimersByTime(1100);
      expect(ofKind("rage-click")).toHaveLength(0);

      for (let click: number = 0; click < 5; click++) {
        clickAt(100, 100);
      }

      jest.advanceTimersByTime(1100);
      expect(ofKind("rage-click")).toHaveLength(1);
      expect(ofKind("rage-click")[0]?.clickCount).toBe(5);
    });

    it("uses the rule's time between clicks", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.rageClick.windowMs = 2500;
        }),
      );

      // Three clicks over 2 seconds: too slow for the built-in second, inside 2.5 s.
      clickAt(100, 100);
      jest.advanceTimersByTime(1000);
      clickAt(100, 100);
      jest.advanceTimersByTime(1000);
      clickAt(100, 100);
      jest.advanceTimersByTime(2600);

      expect(ofKind("rage-click")).toHaveLength(1);
    });

    it("leaves the same three clicks alone under the built-in second", (): void => {
      start(rulesWith((): void => {}));

      clickAt(100, 100);
      jest.advanceTimersByTime(1000);
      clickAt(100, 100);
      jest.advanceTimersByTime(1000);
      clickAt(100, 100);
      jest.advanceTimersByTime(1100);

      expect(ofKind("rage-click")).toHaveLength(0);
    });

    it("uses the rule's distance", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.rageClick.radiusPx = 5;
        }),
      );

      // 20 px apart: one spot to the built-in 30 px, three to a 5 px rule.
      clickAt(100, 100);
      clickAt(120, 100);
      clickAt(140, 100);
      jest.advanceTimersByTime(1100);

      expect(ofKind("rage-click")).toHaveLength(0);
    });

    it("never counts clicks on an element the rule ignores, or inside one", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.rageClick.ignoreSelectors = [".quantity-stepper"];
        }),
      );

      const plus: Element = document.getElementById("plus") as Element;

      for (let click: number = 0; click < 6; click++) {
        clickAt(100, 100, plus);
      }

      jest.advanceTimersByTime(1100);
      expect(ofKind("rage-click")).toHaveLength(0);

      // Anywhere else, the rule still holds.
      const widget: Element = document.getElementById("widget") as Element;

      for (let click: number = 0; click < 3; click++) {
        clickAt(300, 300, widget);
      }

      jest.advanceTimersByTime(1100);
      expect(ofKind("rage-click")).toHaveLength(1);
    });

    it("treats a selector this browser cannot read as ignoring nothing", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.rageClick.ignoreSelectors = ["div[", ".quantity-stepper"];
        }),
      );

      const widget: Element = document.getElementById("widget") as Element;

      for (let click: number = 0; click < 3; click++) {
        clickAt(100, 100, widget);
      }

      jest.advanceTimersByTime(1100);
      expect(ofKind("rage-click")).toHaveLength(1);
    });

    it("detects nothing when switched off", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.rageClick.isEnabled = false;
        }),
      );

      for (let click: number = 0; click < 10; click++) {
        clickAt(100, 100);
      }

      jest.advanceTimersByTime(1100);
      expect(ofKind("rage-click")).toHaveLength(0);
    });
  });

  describe("dead clicks", (): void => {
    it("waits as long as the rule says before calling a click dead", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.deadClick.timeoutMs = 6000;
        }),
      );

      clickAt(10, 10, document.getElementById("widget") as Element);

      jest.advanceTimersByTime(3100);
      expect(ofKind("dead-click")).toHaveLength(0);

      jest.advanceTimersByTime(3000);
      expect(ofKind("dead-click")).toHaveLength(1);
    });

    it("never arms on an element the rule ignores", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.deadClick.ignoreSelectors = ["#carousel"];
        }),
      );

      clickAt(10, 10, document.getElementById("carousel") as Element);
      jest.advanceTimersByTime(3100);

      expect(ofKind("dead-click")).toHaveLength(0);
    });

    it("detects nothing when switched off", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.deadClick.isEnabled = false;
        }),
      );

      clickAt(10, 10, document.getElementById("widget") as Element);
      jest.advanceTimersByTime(10000);

      expect(ofKind("dead-click")).toHaveLength(0);
    });
  });

  describe("error clicks", (): void => {
    it("uses the rule's time after a click", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.errorClick.windowMs = 3000;
        }),
      );

      clickAt(10, 10);
      detector?.notifyError(Date.now() + 2500);

      expect(ofKind("error-click")).toHaveLength(1);
    });

    it("leaves an error two seconds after a click alone under a one-second rule", (): void => {
      start(rulesWith((): void => {}));

      clickAt(10, 10);
      detector?.notifyError(Date.now() + 2000);

      expect(ofKind("error-click")).toHaveLength(0);
    });

    it("detects nothing when switched off", (): void => {
      start(
        rulesWith((settings: SessionReplayFrustrationSettings): void => {
          settings.errorClick.isEnabled = false;
        }),
      );

      clickAt(10, 10);
      detector?.notifyError(Date.now());

      expect(ofKind("error-click")).toHaveLength(0);
    });
  });

  it("installs no click listener at all when every click rule is off", (): void => {
    const addSpy: jest.SpyInstance = jest.spyOn(document, "addEventListener");

    start(
      rulesWith((settings: SessionReplayFrustrationSettings): void => {
        settings.rageClick.isEnabled = false;
        settings.deadClick.isEnabled = false;
        settings.errorClick.isEnabled = false;
      }),
    );

    expect(
      addSpy.mock.calls.filter((call: Array<unknown>): boolean => {
        return call[0] === "click";
      }),
    ).toHaveLength(0);

    addSpy.mockRestore();
  });

  it("without rules, keeps the built-in ones", (): void => {
    detector = new FrustrationDetector({
      emitCustomEvent: (): void => {},
      onSignal: (signal: FrustrationSignal): void => {
        signals.push(signal);
      },
    });
    detector.start(document);

    clickAt(100, 100);
    clickAt(100, 100);
    clickAt(100, 100);
    jest.advanceTimersByTime(1100);

    expect(ofKind("rage-click")).toHaveLength(1);
  });
});

describe("refresh rage with the application's numbers", (): void => {
  beforeEach((): void => {
    window.localStorage.clear();
  });

  it("counts loads inside the rule's window only", (): void => {
    const url: string = "https://shop.example.com/checkout";
    const startedAt: number = 1_800_000_000_000;

    SessionId.recordPageLoad(url, startedAt, 30_000);
    SessionId.recordPageLoad(url, startedAt + 20_000, 30_000);

    // 40 s after the first: outside a 30 s window, inside the built-in 60 s.
    expect(SessionId.recordPageLoad(url, startedAt + 40_000, 30_000)).toBe(2);
  });

  it("calls it refresh rage at the rule's count", (): void => {
    expect(SessionId.isRefreshRage(2, 2)).toBe(true);
    expect(SessionId.isRefreshRage(3, 4)).toBe(false);
    // The built-in three when no count is given.
    expect(SessionId.isRefreshRage(3)).toBe(true);
    expect(SessionId.isRefreshRage(2)).toBe(false);
  });
});
