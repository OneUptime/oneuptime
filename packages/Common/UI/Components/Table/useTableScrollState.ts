import {
  TABLE_HEADER_WRAP_ATTRIBUTE,
  TABLE_NAME_FILL_FLOOR_IN_PX,
  TABLE_SHRINKABLE_ATTRIBUTE,
  TABLE_VALUE_ATTRIBUTE,
  TABLE_VALUE_GIVE_ATTRIBUTE,
  TABLE_VALUE_GIVE_FLOOR_IN_PX,
} from "./TableLayout";
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
 *
 * And a table that fits lets the row's name - its first column - use the
 * room its row has, so a long name is cut short only where there is no
 * more room for it, not at its 20rem cap with half the row empty. The
 * name's value carries data-fill="true" then (TableLayout's
 * TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME). Whether the table fits is always
 * measured that way - the names set free for the reading, whatever they
 * were - each able to give way down to 10rem; a table that does not fit
 * even so scrolls, its names back at their 20rem cap. Every reading starts
 * from the same place, so the two states cannot chase each other.
 *
 * Only a name drawn as a line of text is set free: a person's picture
 * beside their name, or a name over its address, keeps its cap - it would
 * wrap inside itself, and its row grow, where a line is cut short after its
 * first line (isLineOfText). Nor is a name no wider than the 10rem floor
 * (getNamesWiderThanFloor): it has nothing to give, and the floor would
 * only widen its column.
 *
 * A table that does not fit with its names given way gives way more before
 * its rows scroll: first its header's names break between their words
 * (TABLE_HEADER_WRAP_ATTRIBUTE on the table), then its other long values
 * are cut short a little more, never below 8rem (TABLE_VALUE_GIVE_ATTRIBUTE
 * on each value wider than that). Beside a side menu at 1280px a card is
 * about 940px wide: the incidents and alerts lists, Runners, Twilio
 * configs, threat intel feeds and AI rules in German ran under their sticky
 * Actions column for a header of two words or a name 30px too long.
 *
 * Giving way is only ever how a table comes to fit: a table that does not
 * fit even so scrolls exactly as it did, its names at their cap, its
 * header's names on one line ("Incident Number" over two lines in bold was
 * what the table redesign took out) and every value whole - it has the room
 * of the scroll to show them in. The readings are tried in one order
 * (TABLE_GIVE_WAY_READINGS), each from where the first one started, so
 * they cannot chase each other.
 */

// The attribute a row's name carries while it uses the room its row has.
export const TABLE_FILL_ATTRIBUTE: string = "data-fill";

/*
 * The attribute on the value of a row's name that may use the room of a
 * table that fits (TableRow, by CellClassName's isFillingNameColumn).
 */
export const TABLE_NAME_ATTRIBUTE: string = "data-table-name";

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
 * Whether an element, or anything between it and the page, scrolls or hides
 * its overflow - asked of the table's box's parent (the box's own sideways
 * scroll is the hook's). Exported for its tests.
 */
export const isInsideScrollingBox: (element: Element | null) => boolean = (
  element: Element | null,
): boolean => {
  if (!element || typeof window === "undefined" || !window.getComputedStyle) {
    return false;
  }

  let node: Element | null = element;

  while (node && node !== document.body && node !== document.documentElement) {
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
 * How a line of text's parts are laid out: in the line, or not at all. An
 * element no style has given a display is inline - the property's initial
 * value - which a page without a stylesheet (jsdom) reads as "".
 */
const LINE_DISPLAY_VALUES: Array<string> = ["inline", "contents", "none", ""];

/*
 * Whether a value is a line of text - words, a link, an icon or a picture
 * in it - that can be cut short after its first line. A part laid out as a
 * box of its own with words in it (a block, a flex row, an inline-block)
 * would wrap inside itself instead, and its row grow; a box with no words
 * in it - an icon, an avatar, a colour's dot - cannot. Exported for its
 * tests.
 */
export const isLineOfText: (element: Element) => boolean = (
  element: Element,
): boolean => {
  if (typeof window === "undefined" || !window.getComputedStyle) {
    return false;
  }

  return Array.from(element.children).every((part: Element): boolean => {
    if (LINE_DISPLAY_VALUES.includes(window.getComputedStyle(part).display)) {
      // In the line: so must be what it holds.
      return isLineOfText(part);
    }

    return !(part.textContent || "").trim();
  });
};

/*
 * Which of the rows' names are wider than the 10rem a name set free gives
 * way to (TABLE_NAME_FILL_FLOOR_IN_PX). Only those are set free: "Checkout
 * API" has nothing to give, and the floor would only widen its column.
 *
 * Each is read as wide as its words (width: max-content, up to its 20rem
 * cap), not as wide as its column is now: a table that fits shares its
 * spare room out among its columns, and a short name in a column made wide
 * that way is still short. Read so, a measurement never depends on the one
 * before it, and the two cannot chase each other. Exported for its tests.
 */
export const getNamesWiderThanFloor: (
  names: Array<HTMLElement>,
) => Array<boolean> = (names: Array<HTMLElement>): Array<boolean> => {
  names.forEach((name: HTMLElement) => {
    name.style.width = "max-content";
  });

  const isWide: Array<boolean> = names.map((name: HTMLElement): boolean => {
    return name.scrollWidth > TABLE_NAME_FILL_FLOOR_IN_PX;
  });

  names.forEach((name: HTMLElement) => {
    name.style.removeProperty("width");
  });

  return isWide;
};

/*
 * How a value would be cut short to give room - as a line of text, or as a
 * box of parts that each end in "..." (a list, a pill) - or null when it
 * cannot be: it is no wider than the floor, or it is something else (a row
 * of avatars, a status dot beside words), which would only be clipped.
 * Exported for its tests.
 */
export const getValueGiveKind: (value: HTMLElement) => "line" | "box" | null = (
  value: HTMLElement,
): "line" | "box" | null => {
  if (value.scrollWidth <= TABLE_VALUE_GIVE_FLOOR_IN_PX) {
    return null;
  }

  if (isLineOfText(value)) {
    return "line";
  }

  const parts: Array<Element> = Array.from(value.children);

  if (
    parts.length > 0 &&
    parts.every((part: Element): boolean => {
      return part.hasAttribute(TABLE_SHRINKABLE_ATTRIBUTE);
    })
  ) {
    return "box";
  }

  return null;
};

/*
 * What has given way in one reading of a table's width: its names set free
 * (fill), its header's names wrapping (wrap), its long values cut short
 * (give).
 */
export interface TableGiveWayReading {
  fill: boolean;
  wrap: boolean;
  give: boolean;
}

/*
 * The readings a table is measured in, in order: the first that fits is
 * kept. A table whose names are short ones (which the fill's 10rem floor
 * would only widen) fits as it always did in the last, with nothing given
 * way; a table that fits in none of them scrolls in the last too.
 * Exported for its tests.
 */
export const TABLE_GIVE_WAY_READINGS: ReadonlyArray<TableGiveWayReading> = [
  { fill: true, wrap: false, give: false },
  { fill: true, wrap: true, give: false },
  { fill: true, wrap: true, give: true },
  { fill: false, wrap: false, give: false },
];

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

      if (!box) {
        return;
      }

      /*
       * No table drawn - a phone shows its rows as cards: nothing scrolls
       * sideways. A reading the desktop layout left behind would otherwise
       * keep the cards in a sideways scroll box of their own.
       */
      if (!table) {
        setState((current: TableScrollState): TableScrollState => {
          return current.isOverflowing
            ? { isOverflowing: false, canStickHeader: current.canStickHeader }
            : current;
        });

        return;
      }

      // The rows' names that may use the room of a table that fits.
      const names: Array<HTMLElement> = Array.from(
        table.querySelectorAll<HTMLElement>(`[${TABLE_NAME_ATTRIBUTE}]`),
      );
      const isLine: Array<boolean> = names.map(isLineOfText);

      /*
       * Which names are wider than the floor they would give way to, read
       * at their cap - whole, on one line (getNamesWiderThanFloor). Only
       * those are set free: a shorter one has nothing to give, and the
       * floor would only widen its column, taking the room a long value
       * beside it could have kept.
       */
      names.forEach((name: HTMLElement) => {
        name.setAttribute(TABLE_FILL_ATTRIBUTE, "false");
      });

      const isWide: Array<boolean> = getNamesWiderThanFloor(names);

      // The other values that may be cut short a little more.
      const values: Array<HTMLElement> = Array.from(
        table.querySelectorAll<HTMLElement>(`[${TABLE_VALUE_ATTRIBUTE}]`),
      );

      type SetFillFunction = (isFilling: boolean) => void;

      const setFill: SetFillFunction = (isFilling: boolean): void => {
        names.forEach((name: HTMLElement, index: number) => {
          name.setAttribute(
            TABLE_FILL_ATTRIBUTE,
            isFilling && isLine[index] && isWide[index] ? "true" : "false",
          );
        });
      };

      const setHeadersWrap: SetFillFunction = (isWrapping: boolean): void => {
        if (isWrapping) {
          table.setAttribute(TABLE_HEADER_WRAP_ATTRIBUTE, "true");
        } else {
          table.removeAttribute(TABLE_HEADER_WRAP_ATTRIBUTE);
        }
      };

      /*
       * How each value would be cut short, read once, with every value
       * whole: a value's width is its own, whatever the others do.
       */
      let kinds: Array<"line" | "box" | null> | null = null;

      const setValuesGive: SetFillFunction = (isGiving: boolean): void => {
        if (isGiving && !kinds) {
          kinds = values.map(getValueGiveKind);
        }

        values.forEach((value: HTMLElement, index: number) => {
          const kind: "line" | "box" | null =
            isGiving && kinds ? kinds[index] || null : null;

          if (kind) {
            value.setAttribute(TABLE_VALUE_GIVE_ATTRIBUTE, kind);
          } else {
            value.removeAttribute(TABLE_VALUE_GIVE_ATTRIBUTE);
          }
        });
      };

      const fitsNow: () => boolean = (): boolean => {
        return !isTableOverflowing({
          tableWidth: table.getBoundingClientRect().width,
          boxWidth: box.getBoundingClientRect().width,
        });
      };

      // Every value whole before anything else is read.
      setValuesGive(false);

      let isOverflowing: boolean = true;

      for (const reading of TABLE_GIVE_WAY_READINGS) {
        setFill(reading.fill);
        setHeadersWrap(reading.wrap);
        setValuesGive(reading.give);

        if (fitsNow()) {
          isOverflowing = false;
          break;
        }
      }

      /*
       * Read from the box's parent up: the box's own sideways scroll is this
       * hook's doing (Table gives it overflow-x-auto while the rows
       * overflow), so a table that scrolled sideways and fits again - the
       * window made wider - would otherwise be taken for one inside a
       * scrolling box, and its header would never stick again.
       */
      const canStickHeader: boolean =
        !isOverflowing && !isInsideScrollingBox(box.parentElement);

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

    let frame: number | null = null;

    /*
     * Measured on the next frame, not in the observer's call: the measuring
     * sets the names free and back, and a size that changes inside the call
     * is one the observer cannot deliver - the page gets an error ("loop
     * completed with undelivered notifications") on every resize.
     */
    const observer: ResizeObserver = new ResizeObserver(() => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    });

    if (data.scrollRef.current) {
      observer.observe(data.scrollRef.current);
    }

    if (data.tableRef.current) {
      observer.observe(data.tableRef.current);
    }

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      observer.disconnect();
    };
  }, data.watch);

  return state;
};

export default useTableScrollState;
