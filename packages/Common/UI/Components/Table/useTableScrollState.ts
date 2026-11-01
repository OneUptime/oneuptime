import {
  TABLE_HEADER_WRAP_ATTRIBUTE,
  TABLE_NAME_FILL_FLOOR_IN_PX,
  TABLE_SHRINKABLE_ATTRIBUTE,
  TABLE_VALUE_ATTRIBUTE,
  TABLE_VALUE_GIVE_ATTRIBUTE,
  TABLE_VALUE_GIVE_FLOOR_IN_PX,
  TABLE_VALUE_WHOLE_ATTRIBUTE,
  TABLE_VALUE_WHOLE_WIDTH_PROPERTY,
  TABLE_NEARLY_FITS_WITHIN_IN_PX,
} from "./TableLayout";
import React, { useLayoutEffect, useRef, useState } from "react";

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

/*
 * What a table did not fit in: the width it took with everything given
 * way (its last reading but one), and the box's. A table that cannot fit
 * may fold its foldable columns, or be drawn as cards (Table's TableFit),
 * and comes back once its box is that wide.
 */
export interface TableCannotFit {
  tightWidth: number;
  boxWidth: number;
}

// How a value would be cut short, or not at all (getValueGiveKind).
export type TableValueGiveKind = "line" | "box" | null;

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
export const getValueGiveKind: (value: HTMLElement) => TableValueGiveKind = (
  value: HTMLElement,
): TableValueGiveKind => {
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
 *
 * In the reading that gives values way, only what has to give way stays
 * cut short (keepWholeWhatFits): the table shares its room by how long its
 * values are, so a person's name beside a column of prose was cut to
 * "Grace Hop..." while the prose had room to wrap a line more.
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

/*
 * While a person drags a column's edge (ColumnResize), the table's width
 * changes every frame, and reading it each time - every name set free and
 * back, every value cut short and whole, four times over - would be the
 * whole table laid out four times a frame. So the readings wait while
 * isHeldRef says so, and run once when the column is let go: the table
 * calls what remeasureRef holds.
 */
export interface TableScrollStateHold {
  isHeldRef: React.MutableRefObject<boolean>;
  remeasureRef: React.MutableRefObject<(() => void) | null>;
}

/*
 * How wide each value is whole - on one line, up to the table's 20rem cap
 * (TABLE_CELL_MAX_WIDTH_CLASS_NAME, which still holds while it is read) -
 * read with each set to max-content, as a row's name is read
 * (getNamesWiderThanFloor), and left as it was. Exported for its tests.
 */
export const getWholeValueWidths: (
  values: Array<HTMLElement>,
) => Array<number> = (values: Array<HTMLElement>): Array<number> => {
  values.forEach((value: HTMLElement) => {
    value.style.width = "max-content";
  });

  const widths: Array<number> = values.map((value: HTMLElement): number => {
    return Math.ceil(value.getBoundingClientRect().width);
  });

  values.forEach((value: HTMLElement) => {
    value.style.removeProperty("width");
  });

  return widths;
};

/*
 * Every value back to how it is drawn, before a measurement starts: none
 * held whole.
 */
export const releaseWholeValues: (values: Array<HTMLElement>) => void = (
  values: Array<HTMLElement>,
): void => {
  values.forEach((value: HTMLElement) => {
    if (value.hasAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE)) {
      value.removeAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE);
      value.style.removeProperty(TABLE_VALUE_WHOLE_WIDTH_PROPERTY);
    }
  });
};

/*
 * Once the table fits, the values cut short that can be whole are made
 * whole: one column at a time, the one that takes back the least room
 * first, kept whole only while the table still fits and nothing else is
 * cut shorter for it - no row's name set free (TABLE_FILL_ATTRIBUTE), no
 * value whole already. The room comes from where it is spare - a column
 * of prose wraps a line more, the room the table shares out - so what is
 * cut short is only what has to be.
 *
 * A value is cut short when it has given way (TABLE_VALUE_GIVE_ATTRIBUTE),
 * or when it is narrower than it is whole: a part of it ends in "..." of
 * its own - a person's name beside their picture, a list's items - and a
 * table hands such a column only the room it shares out by how long its
 * values are, not by what they are. Beside a case's two lines of prose,
 * the person it was assigned to read "Grace Hop..." and "Margaret H..." in
 * German and Russian at 1280px, while the prose had room for a line more.
 * Made whole, a value is held at its whole width (TABLE_VALUE_WHOLE_ATTRIBUTE,
 * TABLE_VALUE_WHOLE_CLASS_NAME) until the next measurement - by a class,
 * which a column a person sized (ColumnResize) overrules. Exported for its
 * tests.
 */
export const keepWholeWhatFits: (data: {
  values: Array<HTMLElement>;
  // Each value's width whole (getWholeValueWidths).
  wholeWidths: Array<number>;
  // The rows' names set free, which are never cut shorter for a value.
  names: Array<HTMLElement>;
  fitsNow: () => boolean;
}) => void = (data: {
  values: Array<HTMLElement>;
  wholeWidths: Array<number>;
  names: Array<HTMLElement>;
  fitsNow: () => boolean;
}): void => {
  const widthOf: (element: HTMLElement) => number = (
    element: HTMLElement,
  ): number => {
    return element.getBoundingClientRect().width;
  };

  /*
   * How much narrower than whole each value is now: more than a pixel, and
   * it is cut short.
   */
  const getShortfall: (index: number) => number = (index: number): number => {
    return (
      (data.wholeWidths[index] || 0) -
      widthOf(data.values[index] as HTMLElement)
    );
  };

  const isCut: (index: number) => boolean = (index: number): boolean => {
    return (
      (data.values[index] as HTMLElement).hasAttribute(
        TABLE_VALUE_GIVE_ATTRIBUTE,
      ) || getShortfall(index) > 1
    );
  };

  // How each value is drawn now: given way, or not.
  const givenKinds: Array<string | null> = data.values.map(
    (value: HTMLElement): string | null => {
      return value.getAttribute(TABLE_VALUE_GIVE_ATTRIBUTE);
    },
  );

  // The values cut short now, by their column: the cell's place in its row.
  const columns: Map<number, Array<number>> = new Map();
  const wholeIndexes: Array<number> = [];

  data.values.forEach((value: HTMLElement, index: number) => {
    if (!isCut(index)) {
      wholeIndexes.push(index);
      return;
    }

    const cell: HTMLTableCellElement | null = value.closest("td");
    const column: number = cell ? cell.cellIndex : -1;
    const indexes: Array<number> = columns.get(column) || [];

    indexes.push(index);
    columns.set(column, indexes);
  });

  if (columns.size === 0) {
    return;
  }

  /*
   * How much room each column takes back made whole: as much as its value
   * cut shortest needs. The least first, so the most columns are whole.
   */
  const order: Array<{ indexes: Array<number>; need: number }> = Array.from(
    columns.values(),
  )
    .map((indexes: Array<number>): { indexes: Array<number>; need: number } => {
      return {
        indexes: indexes,
        need: Math.max(...indexes.map(getShortfall)),
      };
    })
    .sort(
      (
        a: { indexes: Array<number>; need: number },
        b: { indexes: Array<number>; need: number },
      ): number => {
        return a.need - b.need;
      },
    );

  const nameWidths: Array<number> = data.names.map(widthOf);

  // Whether anything not to be cut shorter for a value is.
  const isAnythingCutShorter: () => boolean = (): boolean => {
    return (
      data.names.some((name: HTMLElement, index: number): boolean => {
        return widthOf(name) < (nameWidths[index] || 0) - 1;
      }) ||
      wholeIndexes.some((index: number): boolean => {
        return getShortfall(index) > 1;
      })
    );
  };

  for (const column of order) {
    for (const index of column.indexes) {
      const value: HTMLElement = data.values[index] as HTMLElement;

      value.removeAttribute(TABLE_VALUE_GIVE_ATTRIBUTE);
      value.setAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE, "true");
      value.style.setProperty(
        TABLE_VALUE_WHOLE_WIDTH_PROPERTY,
        `${data.wholeWidths[index] || 0}px`,
      );
    }

    if (data.fitsNow() && !isAnythingCutShorter()) {
      wholeIndexes.push(...column.indexes);
      continue;
    }

    // The table needs this column's room: it stays as it was.
    for (const index of column.indexes) {
      const value: HTMLElement = data.values[index] as HTMLElement;
      const givenKind: string | null = givenKinds[index] || null;

      value.removeAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE);
      value.style.removeProperty(TABLE_VALUE_WHOLE_WIDTH_PROPERTY);

      if (givenKind) {
        value.setAttribute(TABLE_VALUE_GIVE_ATTRIBUTE, givenKind);
      }
    }
  }
};

const useTableScrollState: (data: {
  scrollRef: React.RefObject<HTMLElement>;
  tableRef: React.RefObject<HTMLElement>;
  // Anything that can change the table's width: its rows, its columns.
  watch: ReadonlyArray<unknown>;
  hold?: TableScrollStateHold | undefined;
  /*
   * Told when the table does not fit even with everything given way, as
   * it is measured (Table's TableFit folds its columns, or draws its rows
   * as cards); never while a column's edge is dragged.
   */
  onCannotFit?: ((cannotFit: TableCannotFit) => void) | undefined;
}) => TableScrollState = (data: {
  scrollRef: React.RefObject<HTMLElement>;
  tableRef: React.RefObject<HTMLElement>;
  watch: ReadonlyArray<unknown>;
  hold?: TableScrollStateHold | undefined;
  onCannotFit?: ((cannotFit: TableCannotFit) => void) | undefined;
}): TableScrollState => {
  // The latest callback, read when a measurement ends.
  const onCannotFitRef: React.MutableRefObject<
    ((cannotFit: TableCannotFit) => void) | undefined
  > = useRef<((cannotFit: TableCannotFit) => void) | undefined>(
    data.onCannotFit,
  );
  onCannotFitRef.current = data.onCannotFit;

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

      /*
       * None held whole and none given way: every reading starts from the
       * same place. Read off the whole table, not only today's values: a
       * table that folds a column draws another column's value in the
       * same cell (its cells are kept by their place in the row), and what
       * the last measurement wrote on the old value would stay on it.
       */
      releaseWholeValues(
        Array.from(
          table.querySelectorAll<HTMLElement>(
            `[${TABLE_VALUE_WHOLE_ATTRIBUTE}]`,
          ),
        ),
      );
      table
        .querySelectorAll<HTMLElement>(`[${TABLE_VALUE_GIVE_ATTRIBUTE}]`)
        .forEach((given: HTMLElement) => {
          given.removeAttribute(TABLE_VALUE_GIVE_ATTRIBUTE);
        });

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
      let kinds: Array<TableValueGiveKind> | null = null;

      const setValuesGive: SetFillFunction = (isGiving: boolean): void => {
        if (isGiving && !kinds) {
          kinds = values.map(getValueGiveKind);
        }

        values.forEach((value: HTMLElement, index: number) => {
          const kind: TableValueGiveKind =
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

      /*
       * How wide each value is whole, read once: until the values give way,
       * every one is held at it (TABLE_VALUE_WHOLE_ATTRIBUTE) - a value whose
       * part ends in "..." of its own (a person's name beside their
       * picture, a list's items) would otherwise be cut short in the very
       * first reading, before the header's names had wrapped.
       */
      const wholeWidths: Array<number> =
        values.length > 0 ? getWholeValueWidths(values) : [];

      const holdValuesWhole: SetFillFunction = (isHolding: boolean): void => {
        values.forEach((value: HTMLElement, index: number) => {
          if (isHolding) {
            value.setAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE, "true");
            value.style.setProperty(
              TABLE_VALUE_WHOLE_WIDTH_PROPERTY,
              `${wholeWidths[index] || 0}px`,
            );
          } else {
            value.removeAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE);
            value.style.removeProperty(TABLE_VALUE_WHOLE_WIDTH_PROPERTY);
          }
        });
      };

      let isOverflowing: boolean = true;
      // The table's width with everything given way, when even that is too wide.
      let tightWidth: number = 0;

      for (const reading of TABLE_GIVE_WAY_READINGS) {
        setFill(reading.fill);
        setHeadersWrap(reading.wrap);
        setValuesGive(reading.give);
        /*
         * Whole while the names and the header's names give way; then each
         * value may be cut short (its give, or its own "...") - and whole
         * again in the last reading, which only a table that scrolls
         * reaches: it has the scroll's room to show every value in. Let go
         * there, a value that cuts itself short made a table "fit" by
         * cutting a state's pill to "Identifi..." below the 8rem a value
         * gives way to.
         */
        holdValuesWhole(!reading.give);

        if (fitsNow()) {
          isOverflowing = false;

          /*
           * What is cut short and could be whole is made whole, where the
           * table has the room (keepWholeWhatFits).
           */
          if (reading.give) {
            keepWholeWhatFits({
              values: values,
              wholeWidths: wholeWidths,
              names: names.filter((name: HTMLElement): boolean => {
                return name.getAttribute(TABLE_FILL_ATTRIBUTE) === "true";
              }),
              fitsNow: fitsNow,
            });
          }

          break;
        }

        if (reading.give) {
          tightWidth = table.getBoundingClientRect().width;
        }
      }

      /*
       * Too wide even given way, but only just: drawn given way, the rows
       * scrolling the last few pixels, rather than whole and that much
       * wider (TABLE_NEARLY_FITS_WITHIN_IN_PX).
       */
      if (
        isOverflowing &&
        tightWidth > 0 &&
        tightWidth <=
          box.getBoundingClientRect().width + TABLE_NEARLY_FITS_WITHIN_IN_PX
      ) {
        const tightest: TableGiveWayReading = TABLE_GIVE_WAY_READINGS.find(
          (reading: TableGiveWayReading): boolean => {
            return reading.give;
          },
        ) as TableGiveWayReading;

        setFill(tightest.fill);
        setHeadersWrap(tightest.wrap);
        setValuesGive(tightest.give);
        holdValuesWhole(false);
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

      // Too wide even with everything given way: the table may fold or turn to cards.
      if (isOverflowing && tightWidth > 0) {
        onCannotFitRef.current?.({
          tightWidth: Math.ceil(tightWidth),
          boxWidth: Math.floor(box.getBoundingClientRect().width),
        });
      }
    };

    measure();

    if (data.hold) {
      data.hold.remeasureRef.current = measure;
    }

    // Not while a column's edge is dragged (TableScrollStateHold).
    const measureUnlessHeld: () => void = (): void => {
      if (data.hold?.isHeldRef.current) {
        return;
      }

      measure();
    };

    /*
     * ResizeObserver is missing in jsdom and in older browsers: there the
     * table is measured again when the window changes size.
     */
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureUnlessHeld);

      return () => {
        window.removeEventListener("resize", measureUnlessHeld);

        if (data.hold && data.hold.remeasureRef.current === measure) {
          data.hold.remeasureRef.current = null;
        }
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
        measureUnlessHeld();
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

      if (data.hold && data.hold.remeasureRef.current === measure) {
        data.hold.remeasureRef.current = null;
      }
    };
  }, data.watch);

  return state;
};

export default useTableScrollState;
