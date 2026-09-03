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
} from "../../../UI/Components/Table/CellClassName";
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
 * than merely widening the table. A width cap on a nowrap cell is the overlap
 * generator, not the fix.
 *
 * The fix routes both class strings through
 * Common/UI/Components/Table/CellClassName.ts and adds two column options,
 * `wrapContent` and `wrapMaxWidthClassName`, such that a width cap can only
 * ever be emitted together with a wrapping mode.
 *
 * IMPORTANT, and the reason every assertion below is a class / attribute /
 * DOM-structure / text assertion: jsdom performs NO layout. There is no
 * getBoundingClientRect worth reading, no computed line breaking, no overflow
 * and no column widths. Where a reader would reasonably expect "assert the text
 * did not overlap its neighbour", what is asserted instead is the exact class
 * contract the browser would have applied - which is the whole of what the fix
 * changes.
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
 * The two strings the cell renderers hard-coded before CellClassName.ts
 * existed. They are spelled out here, in full, on purpose: the point of the
 * refactor is that roughly two hundred column declarations across the product
 * - dates, counts, badges, ids, none of which have layout coverage of their
 * own - keep byte-for-byte the classes they had. Anything that shifts a single
 * utility in these strings has changed every table in OneUptime.
 */
const DEFAULT_CELL_CLASS_NAME: string =
  "whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-500 sm:pl-6 align-top";
const DEFAULT_LAST_CELL_CLASS_NAME: string =
  "whitespace-nowrap py-4 pl-4 pr-6 text-sm font-medium text-gray-500 sm:pl-6 align-top";

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
 * The width cap of a wrapping column has to live here rather than on the <td>,
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

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

/*
 * The helpers on their own, with hand-built column objects. Cheap, exact, and
 * they pin the two strings without paying for a render - so a failure here
 * says "the class contract moved" rather than "some table broke".
 */
describe("CellClassName helpers", () => {
  test("a column that declares nothing keeps the pre-#3585 cell classes", () => {
    const column: Column<Row> = { title: "Name", type: FieldType.Text };

    expect(
      getTableCellClassName<Row>({
        column: column,
        isLastRenderedColumn: false,
      }),
    ).toBe(DEFAULT_CELL_CLASS_NAME);

    expect(
      getTableCellClassName<Row>({
        column: column,
        isLastRenderedColumn: true,
      }),
    ).toBe(DEFAULT_LAST_CELL_CLASS_NAME);
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
      }),
    ).toBe(
      DEFAULT_CELL_CLASS_NAME.replace(
        "whitespace-nowrap",
        "whitespace-normal break-words",
      ),
    );
  });

  test("the content wrapper is empty unless the column asked for something", () => {
    expect(
      getTableCellContentClassName<Row>({
        title: "Name",
        type: FieldType.Text,
      }),
    ).toBe("");
  });

  test("a wrapping column gets the default width cap, and a named one replaces it", () => {
    expect(
      getTableCellContentClassName<Row>({
        title: "Message",
        type: FieldType.Text,
        wrapContent: true,
      }),
    ).toBe(DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME);

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
    ).toBe("max-w-3xl");
  });

  test("a width cap alone emits nothing - the #3585 pairing is unspellable", () => {
    /*
     * This is the assertion that matters most. `max-w-md` on a cell that is
     * still `whitespace-nowrap` is precisely the combination that painted the
     * status sentence over the Recurrence and Started columns. Through the new
     * API it cannot be expressed: the width is only ever emitted alongside the
     * wrapping mode that makes it safe.
     */
    const column: Column<Row> = {
      title: "Message",
      type: FieldType.Text,
      wrapMaxWidthClassName: "max-w-md",
    };

    expect(getTableCellContentClassName<Row>(column)).toBe("");
    expect(
      getTableCellClassName<Row>({
        column: column,
        isLastRenderedColumn: false,
      }),
    ).toBe(DEFAULT_CELL_CLASS_NAME);
  });

  test("contentClassName still reaches the wrapper, alone and alongside a wrap", () => {
    expect(
      getTableCellContentClassName<Row>({
        title: "Name",
        type: FieldType.Text,
        contentClassName: "text-sm text-gray-900",
      }),
    ).toBe("text-sm text-gray-900");

    expect(
      getTableCellContentClassName<Row>({
        title: "Message",
        type: FieldType.Text,
        wrapContent: true,
        contentClassName: "text-sm text-gray-900",
      }),
    ).toBe(`${DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME} text-sm text-gray-900`);
  });
});

/*
 * The rendered table, which is what the ~200 existing column declarations
 * actually go through. A column that says nothing about wrapping must come out
 * of the refactor with not one class moved, in either the <td> or the wrapper.
 */
describe("columns that declare no wrapping are untouched", () => {
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

  test("the cell class string is byte-for-byte what it was before the fix", () => {
    const { container } = renderTable(columns);
    const cells: Array<HTMLElement> = getBodyCells(container);

    // Non-last cell: pr-3. Last rendered cell: pr-6.
    expect(cells[0]!.getAttribute("class")).toBe(DEFAULT_CELL_CLASS_NAME);
    expect(cells[1]!.getAttribute("class")).toBe(DEFAULT_LAST_CELL_CLASS_NAME);
  });

  test("the content wrapper carries an empty class, not a stray space or a width", () => {
    /*
     * Exactly "" - no separator left behind by the join, and above all no
     * injected max-w-*. A width silently added here would recreate #3585 on
     * every table in the product at once.
     */
    const { container } = renderTable(columns);
    const cells: Array<HTMLElement> = getBodyCells(container);

    expect(getContentWrapper(cells[0]!).getAttribute("class")).toBe("");
    expect(getContentWrapper(cells[1]!).getAttribute("class")).toBe("");
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

  test("with no width named, the wrapper takes the exported default cap", () => {
    const { container } = renderTable(buildColumns(messageColumn));
    const wrapper: HTMLElement = getContentWrapper(getBodyCells(container)[1]!);

    // Asserted against the exported constant, so the two cannot drift apart.
    expect(wrapper).toHaveClass(DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME);
    expect(wrapper.getAttribute("class")).toBe(
      DEFAULT_WRAP_MAX_WIDTH_CLASS_NAME,
    );
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

  test("the row's padding and vertical rhythm survive the refactor", () => {
    /*
     * A wrapping cell must still line up with the nowrap cells beside it -
     * same padding, same type scale, same top alignment. Only the white-space
     * pair is allowed to differ.
     */
    const { container } = renderTable(buildColumns(messageColumn));
    const cells: Array<HTMLElement> = getBodyCells(container);
    const wrappingCell: HTMLElement = cells[1]!;

    for (const className of [
      "py-4",
      "pl-4",
      "sm:pl-6",
      "align-top",
      "text-sm",
      "font-medium",
      "text-gray-500",
    ]) {
      expect(wrappingCell).toHaveClass(className);
    }

    expect(cells[0]).toHaveClass("pr-3");
    expect(wrappingCell).toHaveClass("pr-6");
    expect(wrappingCell).not.toHaveClass("pr-3");
  });

  test("a width cap without wrapContent changes nothing at all", () => {
    /*
     * The rendered proof of the helper-level assertion above: this is the
     * exact declaration #3585 was, and through the new API it produces a plain
     * nowrap cell with an empty wrapper - no capped box for an unbreakable
     * line to overflow out of.
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
    expect(cell.getAttribute("class")).toBe(DEFAULT_LAST_CELL_CLASS_NAME);
    expect(getContentWrapper(cell).getAttribute("class")).toBe("");
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
 * Two things the refactor could have broken quietly, because neither is what
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
    expect(getContentWrapper(cells[2]!).getAttribute("class")).toBe("max-w-xs");
  });

  test("an actions column still gets a bare right-aligned button row", () => {
    /*
     * The actions container now composes onto the same string the content
     * wrapper uses. A column that declares nothing must still produce exactly
     * "flex justify-end": a width cap leaking in here would squeeze the Edit
     * and Delete buttons of every table in the product.
     */
    const { container } = renderTable([
      { title: "Network", type: FieldType.Text, key: "name" },
      { title: "Actions", type: FieldType.Actions, key: null },
    ]);
    const cell: HTMLElement = getBodyCells(container)[1]!;

    expect(getContentWrapper(cell).getAttribute("class")).toBe(
      "flex justify-end",
    );
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
