import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import ReplayTabSwitcher, {
  REPLAY_TAB_PICKER_WIDTH_CLASS_NAME,
  REPLAY_TAB_PICKER_WIDTH_IN_PX,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabSwitcher";
import { ReplayTabSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";
import {
  DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
  DropdownHorizontalAlignment,
} from "../../../UI/Utils/DropdownAlignment";

/*
 * THE TAB PICKER STAYS ON THE SCREEN (#7098).
 *
 * The picker that lists every browser tab of a recording was 28rem wide
 * and always hung from its button's start edge (left-0), so a button near
 * the screen's end, or anywhere but the start of a 390px phone, opened it
 * past the edge, and on a page read right to left the same happened at the
 * other side. It now hangs from the edge of its button with room for it
 * (DropdownAlignment's useDropdownPlacement, as the time range picker
 * does), and where neither edge has room it slides along the line until it
 * sits inside the screen's 8px gutters, in either reading direction.
 *
 * jsdom lays nothing out, so the button's box and the page's width are
 * given here, as a browser would measure them; the E2E suite
 * (SessionReplay/BrowserFixture.spec.ts) checks the drawn box at 390 and
 * 1280px in Arabic and Persian.
 */

const BUTTON_WIDTH_IN_PX: number = 92;

// A side class written into the picker's own class list (bounded: linear).
const SIDE_CLASS_NAME: RegExp =
  /(?:^|[\s"'`])-?(?:left|right|start|end)-(?:px|\d{1,4}|\[[^\]\s]{1,40}\])(?=[\s"'`]|$)/;

const SWITCHER_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabSwitcher.tsx",
);

const PAGES: ReadonlyArray<string> = [
  "/checkout",
  "/cart",
  "/account",
  "/search",
  "/orders",
  "/help",
  "/pricing",
  "/blog",
];

// Eight tabs, two still open: past six the strip offers the picker.
function eightTabs(): Array<ReplayTabSummary> {
  return PAGES.map((page: string, index: number): ReplayTabSummary => {
    const ordinal: number = index + 1;

    return {
      tabId: `tab-${ordinal}`,
      label: `Tab ${ordinal}`,
      ordinal: ordinal,
      durationMs: 30000,
      openedAtMs: index * 20000,
      closedAtMs: index * 20000 + 30000,
      hasFootage: true,
      isActive: ordinal === 1,
      status: ordinal <= 2 ? "open" : "closed",
      firstUrl: `https://app.acme.com${page}`,
      lastUrl: `https://app.acme.com${page}`,
      pageCount: 1,
      errorCount: 0,
      frustrationCount: 0,
    };
  });
}

interface Screen {
  width: number;
  buttonLeft: number;
  isRightToLeft?: boolean | undefined;
}

let current: Screen = { width: 1280, buttonLeft: 600 };

const originalGetBoundingClientRect: () => DOMRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalGetComputedStyle: typeof window.getComputedStyle =
  window.getComputedStyle;

function rect(left: number, width: number): DOMRect {
  return {
    left: left,
    right: left + width,
    x: left,
    y: 100,
    top: 100,
    bottom: 128,
    width: width,
    height: 28,
    toJSON: (): Record<string, never> => {
      return {};
    },
  } as DOMRect;
}

beforeEach(() => {
  current = { width: 1280, buttonLeft: 600 };

  // The page's width, as the hook reads it (getDropdownViewportWidth).
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    get: (): number => {
      return current.width;
    },
  });

  // The picker's button where the test puts it; everything else unmeasured.
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("data-testid") === "replay-tab-picker-button") {
      return rect(current.buttonLeft, BUTTON_WIDTH_IN_PX);
    }

    return rect(0, 0);
  };

  // A page in Persian or Arabic lays its lines out right to left.
  window.getComputedStyle = ((
    element: Element,
    pseudo?: string | null,
  ): CSSStyleDeclaration => {
    const style: CSSStyleDeclaration = originalGetComputedStyle.call(
      window,
      element,
      pseudo,
    );

    if (!current.isRightToLeft) {
      return style;
    }

    return new Proxy(style, {
      get: (target: CSSStyleDeclaration, key: string | symbol): unknown => {
        if (key === "direction") {
          return "rtl";
        }

        const value: unknown = Reflect.get(target, key, target);

        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof window.getComputedStyle;
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  window.getComputedStyle = originalGetComputedStyle;
  delete (document.documentElement as unknown as Record<string, unknown>)[
    "clientWidth"
  ];
});

function openPickerOn(screenSize: Screen): HTMLElement {
  current = screenSize;

  render(
    <ReplayTabSwitcher
      tabs={eightTabs()}
      onSwitchTab={() => {}}
      sessionDurationMs={600000}
    />,
  );

  fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

  return screen.getByTestId("replay-tab-picker");
}

/*
 * The box the picker is drawn in, in screen coordinates, from what the
 * component gave it: the edge it hangs from (data-align, with the class
 * that mirrors on a right-to-left page) and its logical inset.
 */
function drawnBox(
  picker: HTMLElement,
  screenSize: Screen,
): { left: number; right: number } {
  const width: number = Math.min(
    REPLAY_TAB_PICKER_WIDTH_IN_PX,
    screenSize.width - 2 * DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
  );
  const alignment: string | null = picker.getAttribute("data-align");
  const startInset: number = parseFloat(
    picker.style.getPropertyValue("inset-inline-start") || "0",
  );
  const endInset: number = parseFloat(
    picker.style.getPropertyValue("inset-inline-end") || "0",
  );
  const buttonLeft: number = screenSize.buttonLeft;
  const buttonRight: number = screenSize.buttonLeft + BUTTON_WIDTH_IN_PX;

  /*
   * "left" hangs from the line's start: the button's left edge on a page
   * read left to right, its right edge on one read right to left.
   */
  const hangsFromLeftEdge: boolean =
    (alignment === DropdownHorizontalAlignment.Left) !==
    Boolean(screenSize.isRightToLeft);

  if (hangsFromLeftEdge) {
    const inset: number =
      alignment === DropdownHorizontalAlignment.Left ? startInset : endInset;
    const left: number = buttonLeft + inset;

    return { left: left, right: left + width };
  }

  const inset: number =
    alignment === DropdownHorizontalAlignment.Left ? startInset : endInset;
  const right: number = buttonRight - inset;

  return { left: right - width, right: right };
}

function expectOnScreen(picker: HTMLElement, screenSize: Screen): void {
  const box: { left: number; right: number } = drawnBox(picker, screenSize);

  expect(box.left).toBeGreaterThanOrEqual(
    DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
  );
  expect(box.right).toBeLessThanOrEqual(
    screenSize.width - DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
  );
}

describe("the tab picker hangs from the edge of its button with room for it", () => {
  it("from the start, where the line has room after the button", () => {
    const picker: HTMLElement = openPickerOn({ width: 1280, buttonLeft: 600 });

    expect(picker).toHaveAttribute("data-align", "left");
    expect(picker).toHaveClass("left-0");
    expect(picker).not.toHaveClass("right-0");
    expect(picker.getAttribute("style") || "").toBe("");
    expectOnScreen(picker, { width: 1280, buttonLeft: 600 });
  });

  it("from the end, for a button near the end of the line", () => {
    const picker: HTMLElement = openPickerOn({
      width: 1280,
      buttonLeft: 1180,
    });

    expect(picker).toHaveAttribute("data-align", "right");
    expect(picker).toHaveClass("right-0");
    expect(picker).not.toHaveClass("left-0");
    expect(picker.getAttribute("style") || "").toBe("");
    expectOnScreen(picker, { width: 1280, buttonLeft: 1180 });
  });

  it("is 28rem wide, and never wider than the screen between its gutters", () => {
    const picker: HTMLElement = openPickerOn({ width: 1280, buttonLeft: 600 });

    expect(REPLAY_TAB_PICKER_WIDTH_IN_PX).toBe(28 * 16);
    expect(REPLAY_TAB_PICKER_WIDTH_CLASS_NAME).toBe(
      "w-[28rem] max-w-[calc(100vw-1rem)]",
    );

    for (const className of REPLAY_TAB_PICKER_WIDTH_CLASS_NAME.split(" ")) {
      expect(picker).toHaveClass(className);
    }

    // The old cap let a 90vw picker run 39px past a phone's edge from 8px in.
    expect(picker).not.toHaveClass("max-w-[90vw]");
  });
});

describe("on a phone, where neither edge of the button has room, it slides onto the screen", () => {
  it.each([
    ["at the start of a line", 16],
    ["in the middle of a line", 140],
    ["at the end of a line", 282],
  ])("a 390px page, the button %s", (_where: string, buttonLeft: number) => {
    const screenSize: Screen = { width: 390, buttonLeft: buttonLeft };
    const picker: HTMLElement = openPickerOn(screenSize);

    expectOnScreen(picker, screenSize);
  });

  it("the slide is a logical inset on the side it hangs from", () => {
    const picker: HTMLElement = openPickerOn({ width: 390, buttonLeft: 140 });

    // 140 + 374 runs 132px past the right gutter at 382: it slides 132px back.
    expect(picker).toHaveAttribute("data-align", "left");
    expect(picker.style.getPropertyValue("inset-inline-start")).toBe("-132px");
    expect(picker.style.getPropertyValue("left")).toBe("");
    expect(picker.style.getPropertyValue("right")).toBe("");
  });

  it("a 320px page too", () => {
    for (const buttonLeft of [16, 110, 212]) {
      const screenSize: Screen = { width: 320, buttonLeft: buttonLeft };
      const picker: HTMLElement = openPickerOn(screenSize);

      expectOnScreen(picker, screenSize);
      cleanup();
    }
  });

  it("follows the screen when it turns or resizes", () => {
    const picker: HTMLElement = openPickerOn({ width: 1280, buttonLeft: 600 });

    expect(picker.getAttribute("style") || "").toBe("");

    act(() => {
      current = { width: 390, buttonLeft: 140 };
      window.dispatchEvent(new Event("resize"));
    });

    expectOnScreen(screen.getByTestId("replay-tab-picker"), current);
    expect(
      screen
        .getByTestId("replay-tab-picker")
        .style.getPropertyValue("inset-inline-start"),
    ).toBe("-132px");
  });
});

describe("on a page read right to left (Arabic, Persian)", () => {
  it("hangs from the button's start, its right edge, where the line has room", () => {
    // A button 600px from the left of a 1280px page: 588px of line after it, leftwards.
    const screenSize: Screen = {
      width: 1280,
      buttonLeft: 600,
      isRightToLeft: true,
    };
    const picker: HTMLElement = openPickerOn(screenSize);

    expect(picker).toHaveAttribute("data-align", "left");
    expect(picker).toHaveClass("left-0");
    expectOnScreen(picker, screenSize);
  });

  it("from its end, its left edge, for a button near the left of the page", () => {
    const screenSize: Screen = {
      width: 1280,
      buttonLeft: 40,
      isRightToLeft: true,
    };
    const picker: HTMLElement = openPickerOn(screenSize);

    expect(picker).toHaveAttribute("data-align", "right");
    expect(picker).toHaveClass("right-0");
    expectOnScreen(picker, screenSize);
  });

  it.each([16, 140, 282])(
    "slides onto a 390px phone, the button %ipx from its left",
    (buttonLeft: number) => {
      const screenSize: Screen = {
        width: 390,
        buttonLeft: buttonLeft,
        isRightToLeft: true,
      };
      const picker: HTMLElement = openPickerOn(screenSize);

      expectOnScreen(picker, screenSize);
    },
  );

  it("the slide mirrors with the page: a logical inset, never left or right", () => {
    const picker: HTMLElement = openPickerOn({
      width: 390,
      buttonLeft: 140,
      isRightToLeft: true,
    });

    // Mirrored, the button spans 158..250 from the page's start: it hangs from its end and slides 132px.
    expect(picker).toHaveAttribute("data-align", "right");
    expect(picker.style.getPropertyValue("inset-inline-end")).toBe("-132px");
    expect(picker.style.getPropertyValue("left")).toBe("");
    expect(picker.style.getPropertyValue("right")).toBe("");
  });
});

describe("the picker's source", () => {
  const source: string = fs.readFileSync(SWITCHER_SOURCE, "utf8");
  const pickerAt: number = source.indexOf('data-testid="replay-tab-picker"');
  // The picker's own element: from its tag to the end of its opening tag's props.
  const pickerElement: string = source.slice(
    source.lastIndexOf("<div", pickerAt),
    source.indexOf("\n                >", pickerAt),
  );

  it("is found", () => {
    expect(pickerAt).toBeGreaterThan(0);
    expect(pickerElement).toContain('data-testid="replay-tab-picker"');
  });

  it("takes its edge from the placement, never a side of its own", () => {
    expect(pickerElement).toContain("getDropdownAlignmentClassName(");
    expect(pickerElement).toContain("getDropdownShiftStyle(");
    expect(pickerElement).toContain("data-align=");
    expect(pickerElement).not.toMatch(SIDE_CLASS_NAME);
    expect(source).toContain("useDropdownPlacement(");
  });

  it("the side check finds a side written into the picker", () => {
    expect(
      'className="absolute left-0 z-30 mt-1 w-[28rem]"'.match(SIDE_CLASS_NAME),
    ).not.toBeNull();
    expect('className="absolute start-0 z-30"'.match(SIDE_CLASS_NAME)).not.toBe(
      null,
    );
    expect(
      "className={`absolute ${getDropdownAlignmentClassName(x)} z-30`}".match(
        SIDE_CLASS_NAME,
      ),
    ).toBeNull();
  });
});
