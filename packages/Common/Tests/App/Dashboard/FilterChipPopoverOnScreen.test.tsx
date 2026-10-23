import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import FilterChipDateRange from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDateRange";
import FilterChipValueInput from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipValueInput";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * AN OPEN CHIP'S POPOVER STAYS ON THE SCREEN.
 *
 * A popover hangs from its chip's left edge. On a 390px phone the second
 * chip of On-Call Schedules - Labels, beside Owner - starts 207px from the
 * screen's left, and its 288px popover ran past the screen's right edge:
 * the whole page scrolled sideways, the search box half off the screen.
 * Every kind of chip (a list, a date, a typed value) now moves its popover
 * left until it keeps the page's 16px margin - when it opens, when its size
 * changes (the Dashboard writes its Tailwind CSS in the page as classes
 * appear, so a popover's width can land after it opens) and when the window
 * does. jsdom lays nothing out, so the boxes are given here; the
 * OwnerFilters offline suite measures them in a browser.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const PHONE: number = 390;

// Where the chip sits, and how wide its popover is drawn.
let chipLeft: number = 207;
let popoverWidth: number = 288;
let screenWidth: number = PHONE;

type ResizeCallback = () => void;

let resizeCallbacks: Array<ResizeCallback> = [];
let observed: Array<Element> = [];
let disconnects: number = 0;

class FakeResizeObserver {
  private callback: ResizeCallback;

  public constructor(callback: ResizeCallback) {
    this.callback = callback;
    resizeCallbacks.push(callback);
  }

  public observe(element: Element): void {
    observed.push(element);
  }

  public disconnect(): void {
    disconnects++;
    resizeCallbacks = resizeCallbacks.filter(
      (callback: ResizeCallback): boolean => {
        return callback !== this.callback;
      },
    );
  }

  public unobserve(): void {}
}

const realGetBoundingClientRect: () => DOMRect =
  HTMLElement.prototype.getBoundingClientRect;

// jsdom's own offsetWidth (always 0), put back after each test.
const realOffsetWidth: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeEach(() => {
  chipLeft = 207;
  popoverWidth = 288;
  screenWidth = PHONE;
  resizeCallbacks = [];
  observed = [];
  disconnects = 0;

  (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;

  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    get: (): number => {
      return screenWidth;
    },
  });

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: function (this: HTMLElement): number {
      return this.getAttribute("role") === "dialog" ? popoverWidth : 0;
    },
  });

  // The chip's place: the popover's parent.
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.querySelector(":scope > [role='dialog']")) {
      return {
        left: chipLeft,
        right: chipLeft + 100,
        top: 300,
        bottom: 326,
        width: 100,
        height: 26,
        x: chipLeft,
        y: 300,
        toJSON: (): string => {
          return "";
        },
      } as DOMRect;
    }

    return realGetBoundingClientRect.call(this);
  };
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
  if (realOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      realOffsetWidth,
    );
  }
  delete (document.documentElement as unknown as { clientWidth?: number })
    .clientWidth;
  delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
});

const CHIPS: Array<{ name: string; label: string; element: ReactElement }> = [
  {
    name: "a list chip (Labels)",
    label: "Labels",
    element: (
      <FilterChipDropdown
        label="Labels"
        emptyIcon={IconProp.Tag}
        options={[{ value: "night", label: "night-shift" }]}
        isMultiSelect={true}
        value={[]}
        onChange={(): void => {}}
      />
    ),
  },
  {
    name: "a date chip (Last Seen)",
    label: "Last Seen",
    element: (
      <FilterChipDateRange
        label="Last Seen"
        values={[]}
        operator="is"
        onChange={(): void => {}}
      />
    ),
  },
  {
    name: "a typed value chip (Ticket)",
    label: "Ticket",
    element: (
      <FilterChipValueInput
        label="Ticket"
        values={[]}
        operator="contains"
        valueType="text"
        onChange={(): void => {}}
      />
    ),
  },
];

const openChip: (label: string) => HTMLElement = (
  label: string,
): HTMLElement => {
  fireEvent.click(
    screen.getByRole("button", {
      name: (accessibleName: string): boolean => {
        return accessibleName.startsWith(label);
      },
    }),
  );

  return screen.getByRole("dialog");
};

describe("an open chip's popover stays on the screen", () => {
  test.each(CHIPS)(
    "$name, right of the bar on a 390px phone, moves left to keep the 16px margin",
    ({ label, element }: { label: string; element: ReactElement }) => {
      render(element);

      const popover: HTMLElement = openChip(label);

      // 207 + 288 would end at 495: it ends at 374, 16px from the edge.
      expect(popover.style.left).toBe("-121px");
    },
  );

  test.each(CHIPS)(
    "$name that fits stays under its chip",
    ({ label, element }: { label: string; element: ReactElement }) => {
      chipLeft = 70;
      render(element);

      expect(openChip(label).style.left).toBe("");
    },
  );

  test("a popover whose width lands after it opens is placed again as it grows", () => {
    // The width class has no CSS yet: the popover is as narrow as its chip.
    popoverWidth = 100;
    render(CHIPS[0]!.element);

    const popover: HTMLElement = openChip("Labels");

    expect(popover.style.left).toBe("");
    expect(observed).toContain(popover);

    // The CSS lands and the popover is 288px wide.
    popoverWidth = 288;
    act(() => {
      for (const callback of resizeCallbacks) {
        callback();
      }
    });

    expect(popover.style.left).toBe("-121px");
  });

  test("a window that grows lets the popover back under its chip", () => {
    render(CHIPS[0]!.element);

    const popover: HTMLElement = openChip("Labels");

    expect(popover.style.left).toBe("-121px");

    screenWidth = 1024;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(popover.style.left).toBe("");
  });

  test("closed, it stops listening; opened again, it is placed afresh", () => {
    render(CHIPS[0]!.element);

    openChip("Labels");
    // Click the chip again to close it.
    openChipToggle("Labels");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(disconnects).toBe(1);

    chipLeft = 40;
    const reopened: HTMLElement = openChip("Labels");

    expect(reopened.style.left).toBe("");
  });

  test("without a ResizeObserver (an older browser) it is still placed when it opens", () => {
    delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    render(CHIPS[0]!.element);

    expect(openChip("Labels").style.left).toBe("-121px");
  });
});

function openChipToggle(label: string): void {
  fireEvent.click(
    screen.getByRole("button", {
      name: (accessibleName: string): boolean => {
        return accessibleName.startsWith(label);
      },
    }),
  );
}
