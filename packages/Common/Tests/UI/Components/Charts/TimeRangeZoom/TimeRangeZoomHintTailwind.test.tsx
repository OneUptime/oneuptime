import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import TimeRangeZoomHint, {
  TIME_RANGE_ZOOM_HINT_GROUP_CLASS,
  TIME_RANGE_ZOOM_HINT_TEST_ID,
} from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { TimeRangeZoomProvider } from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import TimeRange from "../../../../../Types/Time/TimeRange";

/*
 * Issue #4105: a chart card's "Drag to zoom" hint (TimeRangeZoomHint with
 * revealOnHover) stays out of sight until the reader could use it - while
 * the pointer is over the card, or while the reader tabs through it.
 *
 * It used to reveal on focus-within as well. A press on a chart focuses
 * recharts' own layers (its <g tabindex="-1"> groups), and they keep that
 * focus after the drag, so in a real browser the hint stayed up over a card
 * the pointer had long left. Only keyboard focus (:focus-visible) may reveal
 * it now.
 *
 * jsdom has no stylesheet and no hover, and Tailwind silently ignores a
 * variant it does not know, so the class names alone prove nothing. Every
 * frontend styles itself at runtime with the vendored Play CDN
 * (tailwind-3.4.5.js; see TailwindPlayCdnForeignHiddenRule.test.ts), so this
 * renders the real hint in a chart card, runs the CDN over it the way a page
 * does, and asserts on the CSS it writes for the hint's own classes.
 */

const PLAY_CDN_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Static",
  "Vendor",
  "tailwind",
  "tailwind-3.4.5.js",
);

// Carried by the fixture card only, so its rule marks the fixture's build.
const FIXTURE_SENTINEL_CLASS: string = "isolate";

// What Tailwind 3.4.5 writes for the two ways the hint may show.
const POINTER_OVER_CARD_SELECTOR: string =
  ".group\\/zoomhint:hover .group-hover\\/zoomhint\\:opacity-100";
const KEYBOARD_FOCUS_IN_CARD_SELECTOR: string =
  ".group\\/zoomhint:has(:focus-visible) .group-has-\\[\\:focus-visible\\]\\/zoomhint\\:opacity-100";

interface PlayCdnGlobal {
  config: Record<string, unknown>;
}

interface EmittedRule {
  selector: string;
  opacity: string;
}

function playCdn(): PlayCdnGlobal | undefined {
  return (window as unknown as { tailwind?: PlayCdnGlobal }).tailwind;
}

// The <style> the CDN appends to <head>, recognised by its license banner.
function playCdnStyle(): HTMLStyleElement | undefined {
  return Array.from(document.head.querySelectorAll("style")).find(
    (element: HTMLStyleElement) => {
      return (element.textContent || "").includes("tailwindcss v");
    },
  );
}

// Every top-level style rule the CDN wrote, read through jsdom's CSSOM.
function readEmittedRules(): Array<EmittedRule> {
  const sheet: CSSStyleSheet | null | undefined = playCdnStyle()?.sheet;

  if (!sheet) {
    return [];
  }

  return Array.from(sheet.cssRules)
    .filter((rule: CSSRule): boolean => {
      return rule instanceof CSSStyleRule;
    })
    .map((rule: CSSRule): EmittedRule => {
      const styleRule: CSSStyleRule = rule as CSSStyleRule;
      return {
        selector: styleRule.selectorText,
        opacity: styleRule.style.getPropertyValue("opacity"),
      };
    });
}

// "group-hover/zoomhint:opacity-100" -> ".group-hover\/zoomhint\:opacity-100".
function classSelector(className: string): string {
  return `.${className.replace(/[^\w-]/g, (character: string): string => {
    return `\\${character}`;
  })}`;
}

/*
 * The CDN keeps MutationObservers on the document for the life of the page
 * and exposes none of them; they are recorded as they are built so afterAll
 * can disconnect them before jsdom empties the document.
 */
const OriginalMutationObserver: typeof MutationObserver =
  window.MutationObserver;
const playCdnObservers: Array<MutationObserver> = [];

class RecordingMutationObserver extends OriginalMutationObserver {
  public constructor(callback: MutationCallback) {
    super(callback);
    playCdnObservers.push(this);
  }
}

// Read once the fixture's build has landed; the tests only look.
let hintClasses: Array<string> = [];
let emittedRules: Array<EmittedRule> = [];

function ruleFor(selector: string): EmittedRule | undefined {
  return emittedRules.find((rule: EmittedRule): boolean => {
    return rule.selector === selector;
  });
}

// The rules that make the hint visible: opacity 1 on one of its classes.
function revealSelectors(): Array<string> {
  const ownSelectors: Array<string> = hintClasses.map(classSelector);

  return emittedRules
    .filter((rule: EmittedRule): boolean => {
      return (
        rule.opacity === "1" &&
        ownSelectors.some((selector: string): boolean => {
          return rule.selector.endsWith(selector);
        })
      );
    })
    .map((rule: EmittedRule): string => {
      return rule.selector;
    })
    .sort();
}

beforeAll(async () => {
  window.MutationObserver = RecordingMutationObserver;

  // The CDN announces itself on console.warn; that is noise here.
  const warn: ReturnType<typeof jest.spyOn> = jest
    .spyOn(console, "warn")
    .mockImplementation(() => {});

  const script: HTMLScriptElement = document.createElement("script");
  script.textContent = fs.readFileSync(PLAY_CDN_PATH, "utf-8");
  document.head.appendChild(script);

  warn.mockRestore();

  const cdn: PlayCdnGlobal | undefined = playCdn();

  if (!cdn) {
    throw new Error(
      "the vendored Play CDN did not run: jest-environment-jsdom must execute <script> elements",
    );
  }

  // As the Dashboard's index.ejs sets it, less the fonts.
  cdn.config = { darkMode: "class" };

  // Setting the config starts a full build; let it land first.
  await waitFor(
    () => {
      expect(playCdnStyle()).toBeDefined();
    },
    { timeout: 30000 },
  );

  // The real hint in a chart card on a zoomable page, as the pages nest it.
  render(
    <TimeRangeZoomProvider
      zoom={{
        isZoomed: false,
        rangeBeforeZoom: null,
        timeRange: { range: TimeRange.PAST_ONE_HOUR },
        zoomToTimeRange: (): void => {},
        resetZoom: (): void => {},
      }}
    >
      <div
        className={`${TIME_RANGE_ZOOM_HINT_GROUP_CLASS} ${FIXTURE_SENTINEL_CLASS}`}
      >
        <TimeRangeZoomHint revealOnHover={true} />
      </div>
    </TimeRangeZoomProvider>,
  );

  hintClasses = screen
    .getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)
    .className.split(/\s+/)
    .filter(Boolean);

  // The CDN collects the whole render in one pass: the sentinel marks it.
  await waitFor(
    () => {
      expect(
        readEmittedRules().some((rule: EmittedRule): boolean => {
          return rule.selector === classSelector(FIXTURE_SENTINEL_CLASS);
        }),
      ).toBe(true);
    },
    { timeout: 30000 },
  );

  emittedRules = readEmittedRules();
}, 60000);

afterAll(() => {
  for (const observer of playCdnObservers) {
    observer.disconnect();
  }

  window.MutationObserver = OriginalMutationObserver;
});

describe("the chart card zoom hint's reveal, as the Play CDN styles it", () => {
  test("it is invisible at rest", () => {
    expect(hintClasses).toContain("opacity-0");
    expect(ruleFor(".opacity-0")?.opacity).toBe("0");
  });

  test("the pointer over the card reveals it", () => {
    expect(hintClasses).toContain("group-hover/zoomhint:opacity-100");
    expect(ruleFor(POINTER_OVER_CARD_SELECTOR)?.opacity).toBe("1");
  });

  test("keyboard focus anywhere in the card reveals it", () => {
    expect(hintClasses).toContain(
      "group-has-[:focus-visible]/zoomhint:opacity-100",
    );
    expect(ruleFor(KEYBOARD_FOCUS_IN_CARD_SELECTOR)?.opacity).toBe("1");
  });

  test("those are the only two ways it shows: the focus a mouse press leaves behind is not one", () => {
    const reveals: Array<string> = revealSelectors();

    expect(reveals).toEqual(
      [POINTER_OVER_CARD_SELECTOR, KEYBOARD_FOCUS_IN_CARD_SELECTOR].sort(),
    );
    for (const selector of reveals) {
      expect(selector).not.toContain(":focus-within");
      expect(selector).not.toMatch(/:focus(?![-\w])/);
    }
  });

  test("both reveals are keyed on the NAMED group, not on any plain group above the card", () => {
    expect(TIME_RANGE_ZOOM_HINT_GROUP_CLASS).toBe("group/zoomhint");

    for (const selector of revealSelectors()) {
      expect(selector.startsWith(".group\\/zoomhint:")).toBe(true);
    }
  });
});
