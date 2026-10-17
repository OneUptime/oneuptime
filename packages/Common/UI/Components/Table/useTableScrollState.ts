import React, { useLayoutEffect, useState } from "react";

/*
 * Whether a table's rows are wider than the box it is drawn in, and whether
 * its header row can stay in sight while the page scrolls.
 *
 * A table wider than its card scrolls sideways, in a box of its own
 * (overflow-x-auto), and its Actions column sticks at the box's right edge
 * so each row's View and ⋯ stay in sight (TableLayout).
 *
 * A table that fits is drawn with no scroll box at all, and then its header
 * row can stick to the page under the top bar while a long page scrolls.
 * The two cannot both be had: a scroll box in one direction is one in both
 * (overflow-x: auto makes overflow-y auto too), so a header inside it sticks
 * to that box - which does not scroll up or down - not to the page.
 *
 * Nor can the header stick where something between it and the page clips or
 * scrolls - a dialog's body, a side panel, a box that hides its overflow:
 * the header would stick to that box at the page's top bar's height, and
 * hang in the middle of it.
 */

export interface TableScrollState {
  // The rows are wider than the box: they scroll sideways.
  isOverflowing: boolean;
  // The header row can stick to the page while it scrolls.
  canStickHeader: boolean;
}

// Overflow values that make an element a box its content scrolls in.
const SCROLLING_OVERFLOW_VALUES: Array<string> = [
  "auto",
  "scroll",
  "hidden",
  "overlay",
];

/*
 * Whether the table's box, or anything between it and the page, scrolls or
 * hides its overflow. Exported for its tests.
 */
export const isInsideScrollingBox: (element: Element | null) => boolean = (
  element: Element | null,
): boolean => {
  if (!element || typeof window === "undefined" || !window.getComputedStyle) {
    return false;
  }

  let node: Element | null = element;

  while (
    node &&
    node !== document.body &&
    node !== document.documentElement
  ) {
    const style: CSSStyleDeclaration = window.getComputedStyle(node);

    // Each axis, and the shorthand ("hidden auto") where only it is set.
    const values: Array<string> = [
      style.overflowX,
      style.overflowY,
      ...(style.overflow || "").split(" "),
    ];

    if (
      values.some((value: string): boolean => {
        return SCROLLING_OVERFLOW_VALUES.includes(value);
      })
    ) {
      return true;
    }

    node = node.parentElement;
  }

  return false;
};

/*
 * The widths are compared in whole pixels, so a table a fraction of a pixel
 * wider than its box (sub-pixel layout) is not taken for one that scrolls.
 */
export const isTableOverflowing: (data: {
  tableWidth: number;
  boxWidth: number;
}) => boolean = (data: { tableWidth: number; boxWidth: number }): boolean => {
  if (!data.boxWidth || !data.tableWidth) {
    return false;
  }

  return Math.floor(data.tableWidth) > Math.ceil(data.boxWidth);
};

const useTableScrollState: (data: {
  scrollRef: React.RefObject<HTMLElement>;
  tableRef: React.RefObject<HTMLElement>;
  // Anything that can change the table's width: its rows, its columns.
  watch: ReadonlyArray<unknown>;
}) => TableScrollState = (data: {
  scrollRef: React.RefObject<HTMLElement>;
  tableRef: React.RefObject<HTMLElement>;
  watch: ReadonlyArray<unknown>;
}): TableScrollState => {
  const [state, setState] = useState<TableScrollState>({
    isOverflowing: false,
    canStickHeader: true,
  });

  useLayoutEffect(() => {
    const measure: () => void = (): void => {
      const box: HTMLElement | null = data.scrollRef.current;
      const table: HTMLElement | null = data.tableRef.current;

      if (!box || !table) {
        return;
      }

      const isOverflowing: boolean = isTableOverflowing({
        tableWidth: table.getBoundingClientRect().width,
        boxWidth: box.getBoundingClientRect().width,
      });

      const canStickHeader: boolean =
        !isOverflowing && !isInsideScrollingBox(box);

      setState((current: TableScrollState): TableScrollState => {
        if (
          current.isOverflowing === isOverflowing &&
          current.canStickHeader === canStickHeader
        ) {
          return current;
        }

        return { isOverflowing, canStickHeader };
      });
    };

    measure();

    /*
     * ResizeObserver is missing in jsdom and in older browsers: there the
     * table is measured again when the window changes size.
     */
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const observer: ResizeObserver = new ResizeObserver(() => {
      measure();
    });

    if (data.scrollRef.current) {
      observer.observe(data.scrollRef.current);
    }

    if (data.tableRef.current) {
      observer.observe(data.tableRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, data.watch);

  return state;
};

export default useTableScrollState;
