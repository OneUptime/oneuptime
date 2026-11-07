import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import Table, {
  TABLE_SETTLING_STYLE,
} from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  TABLE_ROWS_DRAWN_CLASS_NAME,
  TABLE_ROWS_DRAWN_PROPERTY,
} from "../../../../UI/Components/Table/TableLayout";
import { TABLE_SETTLING_ATTRIBUTE } from "../../../../UI/Components/Table/useTableScrollState";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../Types/GenericObject";

/*
 * "A first visit at a tablet width paints skeleton rows, then cards once
 * measured" (#5485's follow-ups). On a page's first list the rows are drawn
 * before the page has the rules their new classes need (the Dashboard's
 * Tailwind runtime writes them after the commit that drew them), so what
 * they measure then is not how they will look: the shared Table draws them
 * see-through (TABLE_SETTLING_STYLE) until the next frame's measurement,
 * which has the rules, and shows them fitted.
 *
 * jsdom has no ResizeObserver and no rules: both are stood in for here -
 * the observer whose first call the browser makes on the next frame, and
 * whether the page sets what the rows' own class sets.
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

interface Row extends GenericObject {
  _id: string;
  name: string;
}

const COLUMNS: Columns<Row> = [
  { key: "name", title: "Name", type: FieldType.Text },
];

const ROWS: Array<Row> = [{ _id: "1", name: "Checkout API" }];

interface Browser {
  // The observers' first calls, as the browser makes them a frame later.
  observe: () => void;
  runFrames: () => void;
  restore: () => void;
}

const fakeBrowser: (rules: { areRowsDrawn: boolean }) => Browser = (rules: {
  areRowsDrawn: boolean;
}): Browser => {
  const callbacks: Array<() => void> = [];
  const frames: Map<number, FrameRequestCallback> = new Map();
  let nextFrame: number = 1;

  class FakeResizeObserver {
    public constructor(callback: () => void) {
      callbacks.push(callback);
    }

    public observe(): void {}

    public unobserve(): void {}

    public disconnect(): void {}
  }

  const originalRequest: typeof window.requestAnimationFrame =
    window.requestAnimationFrame;
  const originalCancel: typeof window.cancelAnimationFrame =
    window.cancelAnimationFrame;
  const realGetComputedStyle: typeof window.getComputedStyle =
    window.getComputedStyle.bind(window);

  (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id: number = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    frames.delete(id);
  };

  jest
    .spyOn(window, "getComputedStyle")
    .mockImplementation(
      (element: Element, pseudo?: string | null): CSSStyleDeclaration => {
        const style: CSSStyleDeclaration = realGetComputedStyle(
          element,
          pseudo,
        );

        if (
          !rules.areRowsDrawn ||
          !element.classList.contains(TABLE_ROWS_DRAWN_CLASS_NAME)
        ) {
          return style;
        }

        return new Proxy(style, {
          get: (target: CSSStyleDeclaration, key: string | symbol): unknown => {
            if (key === "getPropertyValue") {
              return (name: string): string => {
                return name === TABLE_ROWS_DRAWN_PROPERTY
                  ? "1"
                  : target.getPropertyValue(name);
              };
            }

            const value: unknown = Reflect.get(target, key);

            return typeof value === "function"
              ? (value as (...args: Array<unknown>) => unknown).bind(target)
              : value;
          },
        });
      },
    );

  return {
    observe: (): void => {
      act(() => {
        for (const callback of callbacks) {
          callback();
        }
      });
    },
    runFrames: (): void => {
      const pending: Array<FrameRequestCallback> = Array.from(frames.values());
      frames.clear();
      act(() => {
        for (const callback of pending) {
          callback(0);
        }
      });
    },
    restore: (): void => {
      delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
      delete (globalThis as unknown as { ResizeObserver?: unknown })
        .ResizeObserver;
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    },
  };
};

const drawTable: () => void = (): void => {
  render(
    <Table<Row>
      id="services-table"
      data={ROWS}
      columns={COLUMNS}
      singularLabel="Service"
      pluralLabel="Services"
      currentPageNumber={1}
      totalItemsCount={ROWS.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      onNavigateToPage={(): void => {}}
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={(): void => {}}
    />,
  );
};

const content: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("table-content");
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a table's rows drawn before the page has their rules", () => {
  test("are drawn see-through, marked as settling - their words where they are", () => {
    const browser: Browser = fakeBrowser({ areRowsDrawn: false });

    try {
      drawTable();

      expect(content()).toHaveAttribute(TABLE_SETTLING_ATTRIBUTE, "true");
      expect(content().style.opacity).toBe("0");
      expect(content().style.pointerEvents).toBe("none");
      // The words are on the page for whatever reads them.
      expect(screen.getByText("Checkout API")).toBeInTheDocument();
    } finally {
      browser.restore();
    }
  });

  test("and are shown once the next frame's measurement has the rules", () => {
    const rules: { areRowsDrawn: boolean } = { areRowsDrawn: false };
    const browser: Browser = fakeBrowser(rules);

    try {
      drawTable();

      expect(content()).toHaveAttribute(TABLE_SETTLING_ATTRIBUTE, "true");

      rules.areRowsDrawn = true;
      browser.observe();
      browser.runFrames();

      expect(content()).not.toHaveAttribute(TABLE_SETTLING_ATTRIBUTE);
      expect(content().getAttribute("style") || "").toBe("");
    } finally {
      browser.restore();
    }
  });

  test("rows whose rules are on the page are shown at once: a later list, a second page", () => {
    const browser: Browser = fakeBrowser({ areRowsDrawn: true });

    try {
      drawTable();

      expect(content()).not.toHaveAttribute(TABLE_SETTLING_ATTRIBUTE);
    } finally {
      browser.restore();
    }
  });

  test("where nothing measures them again (no ResizeObserver), they are shown as they are", () => {
    drawTable();

    expect(content()).not.toHaveAttribute(TABLE_SETTLING_ATTRIBUTE);
    expect(content().getAttribute("style") || "").toBe("");
  });
});

describe("how settling rows are drawn", () => {
  test("see-through at once - no fade out, which would show them as they came - and out of the pointer's way", () => {
    expect(TABLE_SETTLING_STYLE).toEqual({
      opacity: 0,
      transition: "none",
      pointerEvents: "none",
    });
  });
});
