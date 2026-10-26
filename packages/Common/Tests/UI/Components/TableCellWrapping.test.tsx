import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { RenderResult, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import Table from "../../../UI/Components/Table/Table";
import Column from "../../../UI/Components/Table/Types/Column";
import Columns from "../../../UI/Components/Table/Types/Columns";
import {
  DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME,
  getTableCellClassName,
  getTableCellContentClassName,
  isFillingNameColumn,
} from "../../../UI/Components/Table/CellClassName";
import {
  TABLE_BODY_CELL_CLASS_NAME,
  TABLE_CELL_CONTENT_ALIGN_CLASS_NAME,
  TABLE_CELL_MAX_WIDTH_CLASS_NAME,
  TABLE_CELL_TEXT_CLASS_NAME,
  TABLE_CELL_TRUNCATE_CLASS_NAMES,
  TABLE_ACTIONS_CONTENT_CLASS_NAME,
  TABLE_PRIMARY_CELL_TEXT_CLASS_NAME,
  TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME,
  TABLE_ROW_RULE_CLASS_NAME,
  TABLE_VALUE_GIVE_CLASS_NAME,
  TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME,
} from "../../../UI/Components/Table/TableLayout";
import { TABLE_NAME_ATTRIBUTE } from "../../../UI/Components/Table/useTableScrollState";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

/*
 * OneUptime issue #3585 - a status sentence painted over the columns beside it.
 *
 * The Discovery Scans table renders a server-written sentence in its "Responded
 * Hosts" cell (RETIRE_RUN_PAYLOAD in
 * Common/Server/Services/NetworkDeviceDiscoveryScanService.ts, 156 characters).
 * Every desktop body <td> in TableRow.tsx declares `whitespace-nowrap`, and
 * `white-space` is an INHERITED property, so the nowrap reached the sentence
 * whatever classes its own element carried. The cell also carried `max-w-md`,
 * which capped the BOX the unbreakable line then overflowed out of - so the
 * sentence was painted straight across the Recurrence and Started cells rather
 * than merely widening the table. A width cap on a nowrap cell, WITHOUT a clip,
 * is the overlap generator, not the fix.
 *
 * The fix routes both class strings through
 * Common/UI/Components/Table/CellClassName.ts and adds two column options,
 * `wrapContent` and `wrapMaxWidthClassName`.
 *
 * The table redesign (model-table-ui) caps every one-line value too - a long
 * name or title used to widen its column to the whole value and push the
 * Actions column off the card - and keeps #3585's rule by construction: a
 * width cap on a line that does not wrap is only ever written together with
 * the clip and the ellipsis that keep it inside its box
 * (TABLE_CELL_TRUNCATE_CLASS_NAMES). The tests below hold that pairing.
 *
 * IMPORTANT, and the reason every assertion below is a class / attribute /
 * DOM-structure / text assertion: jsdom performs NO layout. There is no
 * getBoundingClientRect worth reading, no computed line breaking, no overflow
 * and no column widths. Where a reader would reasonably expect "assert the text
 * did not overlap its neighbour", what is asserted instead is the exact class
 * contract the browser would have applied. The browser half is measured in
 * Chromium by the ModelTables offline suite (packages/E2E/ModelTables).
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

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
  message?: string | undefined;
}

/*
 * The literal sentence from RETIRE_RUN_PAYLOAD - the text that was on screen
 * when #3585 was reported. Kept verbatim so the fixture is the bug's own data.
 */
const STATUS_MESSAGE: string =
  "Settings changed, so this scan is queued to run again. The hosts the previous run found have been cleared - they described settings this scan no longer has.";

/*
 * A 400-character sentence for the default-renderer path (a column with a key
 * and no getElement). Longer than anything a nowrap cell can hold on a laptop.
 */
const LONG_TEXT: string =
  `A very long status sentence written by the server. ${"The scan reported nothing and this is the reason why. ".repeat(
    8,
  )}`.slice(0, 400);

/*
 * The cell strings of a one-row table of two columns, spelled out in full on
 * purpose: roughly two hundred column declarations across the product -
 * dates, counts, badges, ids, none of which have layout coverage of their own
 * - get exactly these classes. Anything that shifts a single utility in them
 * has changed every table in OneUptime.
 *
 * The first cell starts where the card's text does (pl-6) and is the row's
 * name (medium, gray-900); the last one ends as far in (pr-6). A one-row
 * table's only row is its last, so it draws no rule under itself.
 */
const FIRST_CELL_CLASS_NAME: string =
  "whitespace-nowrap pl-6 pr-3 py-3 align-top text-sm leading-6 font-medium text-gray-900";
const LAST_CELL_CLASS_NAME: string =
  "whitespace-nowrap pl-3 pr-6 py-3 align-top text-sm leading-6 font-normal text-gray-700";

// A one-line value's wrapper: the cap, always with its clip and its ellipsis.
const ONE_LINE_CONTENT_CLASS_NAME: string = [
  TABLE_CELL_MAX_WIDTH_CLASS_NAME,
  TABLE_CELL_TRUNCATE_CLASS_NAMES,
  TABLE_CELL_CONTENT_ALIGN_CLASS_NAME,
].join(" ");

/*
 * A value of any other column but a date, a number, a tick or a colour has
 * the same wrapper, and may be cut short a little more - never below 8rem,
 * never above the cap - when its table would otherwise run past its card
 * (TABLE_VALUE_GIVE_CLASS_NAME, written right after the cap it keeps). Its
 * clip and ellipsis stay.
 */
const GIVING_ONE_LINE_CONTENT_CLASS_NAME: string = [
  TABLE_CELL_MAX_WIDTH_CLASS_NAME,
  TABLE_VALUE_GIVE_CLASS_NAME,
  TABLE_CELL_TRUNCATE_CLASS_NAMES,
  TABLE_CELL_CONTENT_ALIGN_CLASS_NAME,
].join(" ");

/*
 * The row's name - its first column - has the same wrapper, and lifts the
 * cap while its table fits its card (TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME,
 * written right after the cap it lifts). Its clip and ellipsis stay.
 */
const NAME_ONE_LINE_CONTENT_CLASS_NAME: string = [
  TABLE_CELL_MAX_WIDTH_CLASS_NAME,
  TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME,
  TABLE_CELL_TRUNCATE_CLASS_NAMES,
  TABLE_CELL_CONTENT_ALIGN_CLASS_NAME,
].join(" ");

const data: Array<Row> = [
  { _id: "1", name: "10.0.0.0/24", message: STATUS_MESSAGE },
];

type RenderTableFunction = (columns: Columns<Row>) => RenderResult;

const renderTable: RenderTableFunction = (
  columns: Columns<Row>,
): RenderResult => {
  return render(
    <Table<Row>
      id="test-table"
      data={data}
      columns={columns}
      currentPageNumber={1}
      totalItemsCount={data.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Scan"
      pluralLabel="Scans"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
    />,
  );
};

/*
 * The table decides mobile vs desktop from window.innerWidth at mount
 * (< 768 = mobile). jsdom defaults to 1024, so desktop is the baseline and the
 * mobile test must set the width BEFORE rendering.
 */
const setViewportWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

type GetBodyCellsFunction = (container: HTMLElement) => Array<HTMLElement>;

const getBodyCells: GetBodyCellsFunction = (
  container: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(container.querySelectorAll<HTMLElement>("tbody tr td"));
};

/*
 * The <div> TableRow puts directly inside the <td> around a cell's content.
 * The width cap of a column has to live here rather than on the <td>,
 * because `max-width` on a `display: table-cell` box is ignored outright.
 */
type GetContentWrapperFunction = (cell: HTMLElement) => HTMLElement;

const getContentWrapper: GetContentWrapperFunction = (
  cell: HTMLElement,
): HTMLElement => {
  const wrapper: Element | null = cell.firstElementChild;

  if (!(wrapper instanceof HTMLElement)) {
    throw new Error("The cell rendered no content wrapper element.");
  }

  return wrapper;
};

/*
 * Whether a class string writes a max-width without the clip that keeps a
 * line that does not wrap inside it - the #3585 pairing.
 */
const writesUnclippedCap: (className: string) => boolean = (
  className: string,
): boolean => {
  const tokens: Array<string> = className.split(" ");
  const hasCap: boolean = tokens.some((token: string): boolean => {
    return token.slice(token.lastIndexOf(":") + 1).startsWith("max-w-");
  });

  return (
    hasCap &&
    !(tokens.includes("overflow-x-clip") && tokens.includes("text-ellipsis"))
  );
};

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

/*
 * The helpers on their own, with hand-built column objects. Cheap, exact, and
 * they pin the strings without paying for a render - so a failure here says
 * "the class contract moved" rather than "some table broke".
 */
describe("CellClassName helpers", () => {
  test("a column that declares nothing gets the row's one-line cell classes", () => {
    const column: Column<Row> = { title: "Name", type: FieldType.Text };

    expect(
      getTableCellClassName<Row>({
        column: column,
        isLastRenderedColumn: false,
        isFirstRenderedCell: true,
        isLastRow: true,
        isPrimaryColumn: true,
      }),
    ).toBe(FIRST_CELL_CLASS_NAME);

    expect(
      getTableCellClassName<Row>({
        column: column,
        isLastRenderedColumn: true,
        isLastRow: true,
      }),
    ).toBe(LAST_CELL_CLASS_NAME);
  });

  test("a row that is not the last draws the hairline under itself", () => {
    const className: string = getTableCellClassName<Row>({
      column: { title: "Name", type: FieldType.Text },
      isLastRenderedColumn: false,
    });

    expect(className).toBe(
      `whitespace-nowrap pl-3 pr-3 ${TABLE_BODY_CELL_CLASS_NAME} ${TABLE_CELL_TEXT_CLASS_NAME} ${TABLE_ROW_RULE_CLASS_NAME}`,
    );
  });

  test("wrapContent swaps nowrap for whitespace-normal break-words, and nothing else", () => {
    const column: Column<Row> = {
      title: "Message",
      type: FieldType.Text,
      wrapContent: true,
    };

    expect(
      getTableCellClassName<Row>({
        column: column,
        isLastRenderedColumn: false,
        isFirstRenderedCell: true,
        isLastRow: true,
        isPrimaryColumn: true,
      }),
    ).toBe(
      FIRST_CELL_CLASS_NAME.replace(
        "whitespace-nowrap",
        "whitespace-normal break-words",
      ),
    );
  });

  test("a one-line column's wrapper is capped, clipped and ellipsized", () => {
    expect(
      getTableCellContentClassName<Row>({
        title: "Name",
        type: FieldType.Text,
      }),
    ).toBe(GIVING_ONE_LINE_CONTENT_CLASS_NAME);

    // A date says what it says only whole: the plain one-line wrapper.
    expect(
      getTableCellContentClassName<Row>({
        title: "Created",
        type: FieldType.DateTime,
      }),
    ).toBe(ONE_LINE_CONTENT_CLASS_NAME);
  });

  test("a wrapping column gets the default width cap, and a named one replaces it", () => {
    expect(
      getTableCellContentClassName<Row>({
        title: "Message",
        type: FieldType.Text,
        wrapContent: true,
      }),
    ).toBe(
      `${DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME} ${TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME} ${TABLE_CELL_CONTENT_ALIGN_CLASS_NAME}`,
    );

    /*
     * Replaced, not appended: two max-w-* utilities on one element are resolved
     * by Tailwind's stylesheet order rather than the order they were written,
     * so the narrower one would silently lose.
     */
    expect(
      getTableCellContentClassName<Row>({
        title: "Message",
        type: FieldType.Text,
        wrapContent: true,
        wrapMaxWidthClassName: "max-w-3xl",
      }),
    ).toBe(
      `max-w-3xl ${TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME} ${TABLE_CELL_CONTENT_ALIGN_CLASS_NAME}`,
    );
  });

  test("a width cap is never written without its clip - the #3585 pairing is unspellable", () => {
    /*
     * This is the assertion that matters most. `max-w-md` on a cell that is
     * still `whitespace-nowrap`, with nothing clipping it, is precisely the
     * combination that painted the status sentence over the Recurrence and
     * Started columns. A width named without wrapContent is not used at all;
     * the one-line cap the table writes always comes with its clip.
     */
    const column: Column<Row> = {
      title: "Message",
      type: FieldType.Text,
      wrapMaxWidthClassName: "max-w-md",
    };

    const contentClassName: string = getTableCellContentClassName<Row>(column);

    expect(contentClassName).toBe(GIVING_ONE_LINE_CONTENT_CLASS_NAME);
    expect(contentClassName).not.toContain("max-w-md");
    expect(writesUnclippedCap(contentClassName)).toBe(false);
    expect(
      getTableCellClassName<Row>({
        column: column,
        isLastRenderedColumn: false,
        isFirstRenderedCell: true,
        isLastRow: true,
        isPrimaryColumn: true,
      }),
    ).toBe(FIRST_CELL_CLASS_NAME);
  });

  test("a column of prose that names its own floor keeps it, and the table's 10rem one is left off", () => {
    /*
     * The On-Call logs' Triggered By title (min-w-[12rem]): two min-w-*
     * utilities on one element are resolved by the stylesheet's order, so
     * the page's floor could have lost to the table's.
     */
    const contentClassName: string = getTableCellContentClassName<Row>({
      title: "Triggered By",
      type: FieldType.Element,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-sm",
      contentClassName: "min-w-[12rem]",
    });

    expect(contentClassName).toBe(
      `max-w-sm ${TABLE_CELL_CONTENT_ALIGN_CLASS_NAME} min-w-[12rem]`,
    );
    expect(contentClassName).not.toContain(
      TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME,
    );
  });

  test("a page's own cap in contentClassName is kept, clipped the same way, and the table's left off", () => {
    const contentClassName: string = getTableCellContentClassName<Row>({
      title: "Client",
      type: FieldType.Element,
      contentClassName: "max-w-[10rem] 2xl:max-w-[18rem]",
    });

    expect(contentClassName).not.toContain(TABLE_CELL_MAX_WIDTH_CLASS_NAME);
    expect(contentClassName).toContain("max-w-[10rem]");
    expect(contentClassName).toContain("2xl:max-w-[18rem]");
    expect(writesUnclippedCap(contentClassName)).toBe(false);
  });

  test("contentClassName still reaches the wrapper, alone and alongside a wrap", () => {
    expect(
      getTableCellContentClassName<Row>({
        title: "Name",
        type: FieldType.Text,
        contentClassName: "text-sm text-gray-900",
      }),
    ).toBe(`${GIVING_ONE_LINE_CONTENT_CLASS_NAME} text-sm text-gray-900`);

    expect(
      getTableCellContentClassName<Row>({
        title: "Message",
        type: FieldType.Text,
        wrapContent: true,
        contentClassName: "text-sm text-gray-900",
      }),
    ).toBe(
      `${DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME} ${TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME} ${TABLE_CELL_CONTENT_ALIGN_CLASS_NAME} text-sm text-gray-900`,
    );
  });

  test("an Actions column is never capped: its wrapper is the column's own classes or nothing", () => {
    expect(
      getTableCellContentClassName<Row>({
        title: "Actions",
        type: FieldType.Actions,
      }),
    ).toBe("");
  });

  test("the row's name lifts its cap while its table fits, after the cap it lifts and with its clip", () => {
    const contentClassName: string = getTableCellContentClassName<Row>(
      { title: "Name", type: FieldType.Text },
      { isPrimaryColumn: true },
    );

    expect(contentClassName).toBe(NAME_ONE_LINE_CONTENT_CLASS_NAME);
    expect(writesUnclippedCap(contentClassName)).toBe(false);

    // Any other column's value gives way by being cut short instead.
    expect(
      getTableCellContentClassName<Row>(
        { title: "Name", type: FieldType.Text },
        { isPrimaryColumn: false },
      ),
    ).toBe(GIVING_ONE_LINE_CONTENT_CLASS_NAME);
  });

  test("a first column of prose, one with a page's own cap, or the Actions column never lifts a cap", () => {
    const prose: string = getTableCellContentClassName<Row>(
      { title: "Message", type: FieldType.Text, wrapContent: true },
      { isPrimaryColumn: true },
    );
    const measured: string = getTableCellContentClassName<Row>(
      {
        title: "Client",
        type: FieldType.Element,
        contentClassName: "max-w-[10rem] 2xl:max-w-[18rem]",
      },
      { isPrimaryColumn: true },
    );
    const actions: string = getTableCellContentClassName<Row>(
      { title: "Actions", type: FieldType.Actions },
      { isPrimaryColumn: true },
    );

    for (const className of [prose, measured, actions]) {
      expect(className).not.toContain(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME);
      expect(className).not.toContain("data-[fill=true]");
    }
  });

  /*
   * Whether a page draws the name itself (an Element) does not matter here:
   * whether it is a line of text is read off the page, where it is drawn
   * (useTableScrollState's isLineOfText).
   */
  const FILLING_CASES: Array<
    [string, Column<Row>, boolean | undefined, boolean]
  > = [
    ["a name", { title: "Name", type: FieldType.Text }, true, true],
    [
      "a name drawn by its page",
      { title: "Name", type: FieldType.Element },
      true,
      true,
    ],
    [
      "not the first column",
      { title: "Name", type: FieldType.Text },
      false,
      false,
    ],
    [
      "no position given",
      { title: "Name", type: FieldType.Text },
      undefined,
      false,
    ],
    [
      "prose",
      { title: "Note", type: FieldType.Text, wrapContent: true },
      true,
      false,
    ],
    [
      "a page's own cap",
      { title: "Client", type: FieldType.Text, contentClassName: "max-w-xs" },
      true,
      false,
    ],
    [
      "the Actions column",
      { title: "Actions", type: FieldType.Actions },
      true,
      false,
    ],
    [
      "a page's own floor",
      {
        title: "Name",
        type: FieldType.Text,
        contentClassName: "min-w-[14rem]",
      },
      true,
      false,
    ],
  ];

  test.each(FILLING_CASES)(
    "isFillingNameColumn: %s",
    (
      _label: string,
      column: Column<Row>,
      isPrimaryColumn: boolean | undefined,
      expected: boolean,
    ) => {
      expect(isFillingNameColumn<Row>(column, isPrimaryColumn)).toBe(expected);
    },
  );
});

/*
 * The rendered table, which is what the ~200 existing column declarations
 * actually go through.
 */
describe("columns that declare no wrapping", () => {
  const columns: Columns<Row> = [
    { title: "Network", type: FieldType.Text, key: "name" },
    {
      title: "Message",
      type: FieldType.Text,
      key: "message",
      getElement: (item: Row): ReactElement => {
        return <span>{item.message}</span>;
      },
    },
  ];

  test("the cell is still nowrap and never wraps", () => {
    const { container } = renderTable(columns);
    const cells: Array<HTMLElement> = getBodyCells(container);

    expect(cells.length).toBe(2);

    for (const cell of cells) {
      expect(cell).toHaveClass("whitespace-nowrap");
      expect(cell).not.toHaveClass("whitespace-normal");
      expect(cell).not.toHaveClass("break-words");
    }
  });

  test("the cell class strings are exactly the row's", () => {
    const { container } = renderTable(columns);
    const cells: Array<HTMLElement> = getBodyCells(container);

    // First cell: pl-6, the row's name. Last rendered cell: pr-6.
    expect(cells[0]!.getAttribute("class")).toBe(FIRST_CELL_CLASS_NAME);
    expect(cells[1]!.getAttribute("class")).toBe(LAST_CELL_CLASS_NAME);
  });

  test("the content wrapper caps a long value only with its clip and ellipsis", () => {
    /*
     * The 156-character sentence of #3585, in a column that never asked to
     * wrap: cut short at the cap, inside its own column, never painted over
     * the next one.
     */
    const { container } = renderTable(columns);
    const cells: Array<HTMLElement> = getBodyCells(container);

    cells.forEach((cell: HTMLElement, index: number) => {
      const wrapper: HTMLElement = getContentWrapper(cell);

      /*
       * The first column is the row's name: the same wrapper, which lifts
       * its cap while the table fits, marked for useTableScrollState.
       */
      expect(wrapper.getAttribute("class")).toBe(
        index === 0
          ? NAME_ONE_LINE_CONTENT_CLASS_NAME
          : GIVING_ONE_LINE_CONTENT_CLASS_NAME,
      );
      expect(wrapper.hasAttribute(TABLE_NAME_ATTRIBUTE)).toBe(index === 0);
      expect(writesUnclippedCap(wrapper.getAttribute("class") || "")).toBe(
        false,
      );
    });

    expect(cells[1]!.textContent).toBe(STATUS_MESSAGE);
  });
});

/*
 * The Discovery "Responded Hosts" column, in the shape the fix gives it.
 */
describe("columns that opt into wrapping", () => {
  type BuildColumnsFunction = (message: Column<Row>) => Columns<Row>;

  const buildColumns: BuildColumnsFunction = (
    message: Column<Row>,
  ): Columns<Row> => {
    return [{ title: "Network", type: FieldType.Text, key: "name" }, message];
  };

  const messageColumn: Column<Row> = {
    title: "Responded Hosts",
    type: FieldType.Element,
    key: "message",
    wrapContent: true,
    getElement: (item: Row): ReactElement => {
      return (
        <div className="text-xs text-gray-500" title={item.message}>
          {item.message}
        </div>
      );
    },
  };

  test("the cell wraps instead of forcing one unbreakable line", () => {
    /*
     * jsdom does no line breaking, so what is checked is the declaration the
     * browser would break on: nowrap gone, whitespace-normal and break-words
     * present. break-words matters as much as the wrap - a single long token
     * (a URL, a 60-character hostname) has no break opportunity without it.
     */
    const { container } = renderTable(buildColumns(messageColumn));
    const cell: HTMLElement = getBodyCells(container)[1]!;

    expect(cell).toHaveClass("whitespace-normal");
    expect(cell).toHaveClass("break-words");
    expect(cell).not.toHaveClass("whitespace-nowrap");
  });

  test("with no width named, the wrapper takes the exported default cap and the floor", () => {
    const { container } = renderTable(buildColumns(messageColumn));
    const wrapper: HTMLElement = getContentWrapper(getBodyCells(container)[1]!);

    // Asserted against the exported constants, so the two cannot drift apart.
    expect(wrapper).toHaveClass(DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME);
    expect(wrapper).toHaveClass(TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME);
    expect(wrapper.getAttribute("class")).toBe(
      `${DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME} ${TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME} ${TABLE_CELL_CONTENT_ALIGN_CLASS_NAME}`,
    );
    // A wrapping value is never cut short: no clip, no ellipsis.
    expect(wrapper).not.toHaveClass("overflow-x-clip");
    expect(wrapper).not.toHaveClass("text-ellipsis");
  });

  test("a named width replaces the default rather than joining it", () => {
    const { container } = renderTable(
      buildColumns({
        ...messageColumn,
        wrapMaxWidthClassName: "max-w-3xl",
      }),
    );
    const wrapper: HTMLElement = getContentWrapper(getBodyCells(container)[1]!);

    expect(wrapper).toHaveClass("max-w-3xl");
    /*
     * Both present would not be "the last one wins": Tailwind emits max-w-md
     * and max-w-3xl as equally specific rules, so the winner is whichever the
     * stylesheet happens to define later - not the one the column asked for.
     */
    expect(wrapper).not.toHaveClass(DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME);
  });

  test("contentClassName is kept and sits alongside the cap", () => {
    const { container } = renderTable(
      buildColumns({
        ...messageColumn,
        contentClassName: "text-sm text-gray-900",
      }),
    );
    const wrapper: HTMLElement = getContentWrapper(getBodyCells(container)[1]!);

    expect(wrapper).toHaveClass(DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME);
    expect(wrapper).toHaveClass("text-sm");
    expect(wrapper).toHaveClass("text-gray-900");
  });

  test("the row's padding and vertical rhythm hold for a wrapping cell", () => {
    /*
     * A wrapping cell must still line up with the nowrap cells beside it -
     * same padding, same type scale, same top alignment. Only the white-space
     * pair is allowed to differ.
     */
    const { container } = renderTable(buildColumns(messageColumn));
    const cells: Array<HTMLElement> = getBodyCells(container);
    const wrappingCell: HTMLElement = cells[1]!;

    for (const className of [
      "py-3",
      "pl-3",
      "align-top",
      "text-sm",
      "leading-6",
      "font-normal",
      "text-gray-700",
    ]) {
      expect(wrappingCell).toHaveClass(className);
    }

    expect(cells[0]).toHaveClass("pr-3");
    expect(cells[0]).toHaveClass("pl-6");
    expect(wrappingCell).toHaveClass("pr-6");
    expect(wrappingCell).not.toHaveClass("pr-3");
  });

  test("a width cap without wrapContent is not used: the cell is a one-line one", () => {
    /*
     * The rendered proof of the helper-level assertion above: this is the
     * exact declaration #3585 was, and it produces a plain nowrap cell whose
     * wrapper caps the line only together with its clip.
     */
    const { container } = renderTable(
      buildColumns({
        title: "Responded Hosts",
        type: FieldType.Element,
        key: "message",
        wrapMaxWidthClassName: "max-w-md",
        getElement: (item: Row): ReactElement => {
          return <span>{item.message}</span>;
        },
      }),
    );
    const cell: HTMLElement = getBodyCells(container)[1]!;

    expect(cell).toHaveClass("whitespace-nowrap");
    expect(cell.getAttribute("class")).toBe(LAST_CELL_CLASS_NAME);
    expect(getContentWrapper(cell).getAttribute("class")).toBe(
      GIVING_ONE_LINE_CONTENT_CLASS_NAME,
    );
  });

  test("a plain text column with no getElement can wrap too", () => {
    /*
     * The default-renderer path. #3585 was reported on a getElement column,
     * but the great majority of prose cells in the product are plain keyed
     * text; the option is only worth having if it reaches them as well.
     */
    const { container } = renderTable([
      { title: "Network", type: FieldType.Text, key: "name" },
      {
        title: "Message",
        type: FieldType.Text,
        key: "message",
        wrapContent: true,
      },
    ]);
    const cell: HTMLElement = getBodyCells(container)[1]!;

    expect(cell).toHaveClass("whitespace-normal");
    expect(cell).toHaveClass("break-words");
    expect(cell).not.toHaveClass("whitespace-nowrap");
    expect(getContentWrapper(cell)).toHaveClass(
      DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME,
    );
    expect(cell.textContent).toBe(STATUS_MESSAGE);
  });

  test("a 400-character value still lands in a wrapping default-rendered cell", () => {
    const { container } = render(
      <Table<Row>
        id="long-text-table"
        data={[{ _id: "1", name: "10.0.0.0/24", message: LONG_TEXT }]}
        columns={[
          { title: "Network", type: FieldType.Text, key: "name" },
          {
            title: "Message",
            type: FieldType.Text,
            key: "message",
            wrapContent: true,
          },
        ]}
        currentPageNumber={1}
        totalItemsCount={1}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Scan"
        pluralLabel="Scans"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
      />,
    );
    const cell: HTMLElement = getBodyCells(container)[1]!;

    expect(LONG_TEXT.length).toBe(400);
    expect(cell.textContent).toBe(LONG_TEXT);
    expect(cell).toHaveClass("whitespace-normal");
    expect(getContentWrapper(cell)).toHaveClass(
      DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME,
    );
  });
});

/*
 * Two things the shared helper could break quietly, because neither is what
 * the issue was about.
 */
describe("what the shared helper must not disturb", () => {
  test("the extra right padding is decided by rendered columns, not declared ones", () => {
    /*
     * The last-cell test in TableRow compares against the RENDERED column
     * count. A hideOnMobile column is in the fixture because that is where
     * declared and rendered part company; at this width it is rendered, so it
     * is the last cell and it is the one that must carry pr-6. If the helper
     * were ever handed a declared index, the wider padding would land on the
     * wrong cell - or on none.
     */
    setViewportWidth(1280);

    const { container } = renderTable([
      { title: "Network", type: FieldType.Text, key: "name" },
      { title: "Message", type: FieldType.Text, key: "message" },
      {
        title: "Recurrence",
        type: FieldType.Text,
        key: "name",
        hideOnMobile: true,
        wrapContent: true,
        wrapMaxWidthClassName: "max-w-xs",
      },
    ]);
    const cells: Array<HTMLElement> = getBodyCells(container);

    expect(cells.length).toBe(3);
    expect(cells[0]).toHaveClass("pr-3");
    expect(cells[1]).toHaveClass("pr-3");
    expect(cells[2]).toHaveClass("pr-6");
    expect(cells[2]).not.toHaveClass("pr-3");
    expect(getContentWrapper(cells[2]!)).toHaveClass("max-w-xs");
  });

  test("an actions column gets a right-aligned button row with no width cap", () => {
    /*
     * A width cap leaking in here would squeeze the row button and ⋯ menu of
     * every table in the product.
     */
    const { container } = renderTable([
      { title: "Network", type: FieldType.Text, key: "name" },
      { title: "Actions", type: FieldType.Actions, key: null },
    ]);
    const cell: HTMLElement = getBodyCells(container)[1]!;
    const wrapper: HTMLElement = getContentWrapper(cell);

    expect(wrapper.getAttribute("class")).toBe(
      `flex items-center justify-end gap-2 ${TABLE_ACTIONS_CONTENT_CLASS_NAME}`,
    );
    expect(writesUnclippedCap(wrapper.getAttribute("class") || "")).toBe(false);
    expect(wrapper.getAttribute("class")).not.toContain("max-w-");
    expect(cell).toHaveClass("text-end");
  });

  test("the name column is the row's first one, and only that one", () => {
    const { container } = renderTable([
      { title: "Network", type: FieldType.Text, key: "name" },
      { title: "Message", type: FieldType.Text, key: "message" },
    ]);
    const cells: Array<HTMLElement> = getBodyCells(container);

    for (const className of TABLE_PRIMARY_CELL_TEXT_CLASS_NAME.split(" ")) {
      expect(cells[0]).toHaveClass(className);
      expect(cells[1]).not.toHaveClass(className);
    }
  });
});

/*
 * Mobile is a different layout entirely - cards, not a table - and it declares
 * no nowrap of its own, so it never had #3585 and needs neither new option. It
 * deliberately reads neither wrapContent nor contentClassName, which is why the
 * assertions here are about text rather than classes: what must hold is that
 * the label and the whole sentence are on screen.
 */
describe("the mobile card", () => {
  test("renders no table cells, and shows the wrapping column in full", () => {
    setViewportWidth(375);

    renderTable([
      { title: "Network", type: FieldType.Text, key: "name" },
      {
        title: "Responded Hosts",
        type: FieldType.Element,
        key: "message",
        wrapContent: true,
        getElement: (item: Row): ReactElement => {
          return <div className="text-xs text-gray-500">{item.message}</div>;
        },
      },
    ]);

    expect(document.querySelectorAll("td").length).toBe(0);
    expect(screen.getByText("Responded Hosts")).toBeInTheDocument();
    expect(screen.getByText(STATUS_MESSAGE)).toBeInTheDocument();
  });
});
