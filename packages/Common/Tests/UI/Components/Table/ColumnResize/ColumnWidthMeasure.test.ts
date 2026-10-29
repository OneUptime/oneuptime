import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  COLUMN_MEASURE_MAX_ROWS,
  COLUMN_MEASURE_SKIP_ATTRIBUTE,
  COLUMN_RESIZE_HANDLE_ATTRIBUTE,
  ColumnMeasurement,
  SavedHeaderCellWidth,
  getHorizontalPadding,
  measureTableColumn,
  readHeaderCellWidth,
  restoreHeaderCellWidth,
  writeHeaderCellWidth,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnWidthMeasure";
import { ColumnWidthKind } from "../../../../../UI/Components/Table/ColumnResize/ColumnWidths";

/*
 * A column read off the page as a person starts to size it: its header's
 * least and whole width, its widest value whole on one line, its cells'
 * padding - read with every value given `width: max-content` (or
 * min-content, for the header broken between its words) and then given
 * back exactly the style it had.
 *
 * jsdom lays nothing out, so each element says how wide it is under each
 * reading (data-min / data-max / data-now), and getBoundingClientRect
 * answers by the inline width the reading gave it - so a value read
 * without being set to max-content first reads as its column, as it would
 * in a browser, and the test fails. jsdom's style declarations refuse the
 * intrinsic widths (max-content, min-content), so what the reading asks
 * for is recorded as it is set.
 */

interface WidthStub {
  restore: () => void;
  readings: Array<{ element: Element; width: string; display: string }>;
}

const stubWidths: () => WidthStub = (): WidthStub => {
  const readings: Array<{ element: Element; width: string; display: string }> =
    [];
  const original: typeof Element.prototype.getBoundingClientRect =
    Element.prototype.getBoundingClientRect;
  const originalSetProperty: typeof CSSStyleDeclaration.prototype.setProperty =
    CSSStyleDeclaration.prototype.setProperty;
  const originalRemoveProperty: typeof CSSStyleDeclaration.prototype.removeProperty =
    CSSStyleDeclaration.prototype.removeProperty;
  const asked: WeakMap<
    CSSStyleDeclaration,
    Record<string, string>
  > = new WeakMap();

  CSSStyleDeclaration.prototype.setProperty = function (
    this: CSSStyleDeclaration,
    property: string,
    value: string | null,
    priority?: string,
  ): void {
    const record: Record<string, string> = asked.get(this) || {};

    record[property] = value || "";
    asked.set(this, record);
    originalSetProperty.call(this, property, value, priority);
  };

  CSSStyleDeclaration.prototype.removeProperty = function (
    this: CSSStyleDeclaration,
    property: string,
  ): string {
    const record: Record<string, string> | undefined = asked.get(this);

    if (record) {
      delete record[property];
    }

    return originalRemoveProperty.call(this, property);
  };

  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const element: HTMLElement = this as HTMLElement;
    const record: Record<string, string> =
      (element.style && asked.get(element.style)) || {};
    const inlineWidth: string = record["width"] || element.style?.width || "";

    readings.push({
      element: element,
      width: inlineWidth,
      display: record["display"] || element.style?.display || "",
    });

    const read: (name: string) => number = (name: string): number => {
      return Number(element.getAttribute(name) || 0);
    };

    let width: number = read("data-now");

    if (inlineWidth === "0px" && element.hasAttribute("data-least")) {
      // A header cell given no width: the least its column is drawn at.
      width = read("data-least");
    } else if (inlineWidth === "max-content") {
      width = read("data-max");
    } else if (inlineWidth === "min-content") {
      width = read("data-min");
    } else if (inlineWidth.endsWith("px")) {
      width = parseFloat(inlineWidth);
    }

    return {
      width: width,
      height: 20,
      top: 0,
      left: 0,
      right: width,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: (): unknown => {
        return {};
      },
    } as DOMRect;
  };

  return {
    readings: readings,
    restore: (): void => {
      Element.prototype.getBoundingClientRect = original;
      CSSStyleDeclaration.prototype.setProperty = originalSetProperty;
      CSSStyleDeclaration.prototype.removeProperty = originalRemoveProperty;
    },
  };
};

let widths: WidthStub;

beforeEach(() => {
  widths = stubWidths();
});

afterEach(() => {
  widths.restore();
  document.body.innerHTML = "";
  jest.restoreAllMocks();
});

type BuildTableFunction = (html: string) => HTMLTableElement;

const buildTable: BuildTableFunction = (html: string): HTMLTableElement => {
  document.body.innerHTML = html;

  return document.querySelector("table") as HTMLTableElement;
};

const headerCell: (index: number) => HTMLTableCellElement = (
  index: number,
): HTMLTableCellElement => {
  return document.querySelectorAll("thead th")[index] as HTMLTableCellElement;
};

const TABLE: string = `
  <table>
    <thead><tr>
      <th style="padding: 0" data-now="64"><div data-now="64" data-min="20" data-max="20">Box</div></th>
      <th style="padding: 0" data-now="240">
        <button style="padding-left: 24px; padding-right: 12px" data-now="240" data-min="86" data-max="150">Incident Number</button>
        <div ${COLUMN_RESIZE_HANDLE_ATTRIBUTE}="true" data-now="12" data-min="999" data-max="999"></div>
      </th>
    </tr></thead>
    <tbody>
      <tr>
        <td style="padding-left: 12px; padding-right: 24px" data-now="64"><div data-now="20" data-max="20">x</div></td>
        <td style="padding-left: 24px; padding-right: 12px" data-now="240"><div data-now="204" data-max="310">A rather long incident name</div></td>
      </tr>
      <tr>
        <td style="padding-left: 12px; padding-right: 24px" data-now="64"><div data-now="20" data-max="20">x</div></td>
        <td style="padding-left: 24px; padding-right: 12px" data-now="240"><div data-now="90" data-max="90">Short</div></td>
      </tr>
      <tr><td colspan="2" data-now="900"><div data-now="900" data-max="5000">An opened row's details, across the table</div></td></tr>
    </tbody>
    <tbody ${COLUMN_MEASURE_SKIP_ATTRIBUTE}="true">
      <tr>
        <td data-now="64"><div data-max="20"></div></td>
        <td data-now="240"><div data-max="2000">Placeholder</div></td>
      </tr>
    </tbody>
  </table>`;

describe("reading a column off the page", () => {
  test("its header at its least width and on one line, its widest value whole, its cells' padding", () => {
    buildTable(TABLE);

    const measurement: ColumnMeasurement = measureTableColumn({
      headerCell: headerCell(1),
    });

    expect(measurement).toEqual({
      currentWidth: 240,
      headerMinContentWidth: 86,
      headerMaxContentWidth: 150,
      // The long name whole - not 204, as wide as its column now.
      widestValueWidth: 310,
      cellPaddingWidth: 36,
      // A table with no scope draws no sized column: nothing to read.
      leastDrawnWidth: 0,
    });
  });

  test("the edge drawn over the header is no part of the header's content", () => {
    buildTable(TABLE);

    const measurement: ColumnMeasurement = measureTableColumn({
      headerCell: headerCell(1),
    });

    // The edge says 999 under every reading: had it been read, it would show.
    expect(measurement.headerMinContentWidth).toBe(86);
    expect(measurement.headerMaxContentWidth).toBe(150);
  });

  test("a row that spans the table (an opened row's details) and the placeholders of a first load are no rows of the column", () => {
    buildTable(TABLE);

    const measurement: ColumnMeasurement = measureTableColumn({
      headerCell: headerCell(1),
    });

    expect(measurement.widestValueWidth).toBe(310);
  });

  test("each value is read at max-content and the header at min-content, then at max-content", () => {
    buildTable(TABLE);

    measureTableColumn({ headerCell: headerCell(1) });

    const header: Element = document.querySelector("thead th button")!;
    const headerReadings: Array<string> = widths.readings
      .filter((reading: { element: Element }): boolean => {
        return reading.element === header;
      })
      .map((reading: { width: string }): string => {
        return reading.width;
      });

    expect(headerReadings).toEqual(["min-content", "max-content"]);

    const values: Array<Element> = Array.from(
      document.querySelectorAll(
        "tbody:not([data-column-measure-skip]) tr td:nth-child(2) > div",
      ),
    ).slice(0, 2);

    for (const value of values) {
      expect(
        widths.readings
          .filter((reading: { element: Element }): boolean => {
            return reading.element === value;
          })
          .map((reading: { width: string }): string => {
            return reading.width;
          }),
      ).toEqual(["max-content"]);
    }
  });

  test("every element is given back exactly the style it had, its own inline width and priority among it", () => {
    buildTable(TABLE);

    const value: HTMLElement = document.querySelector(
      "tbody tr td:nth-child(2) > div",
    ) as HTMLElement;

    value.style.setProperty("max-width", "20rem");
    value.style.setProperty("min-width", "10rem", "important");

    const header: HTMLElement = document.querySelector(
      "thead th button",
    ) as HTMLElement;

    measureTableColumn({ headerCell: headerCell(1) });

    expect(value.style.getPropertyValue("max-width")).toBe("20rem");
    expect(value.style.getPropertyValue("min-width")).toBe("10rem");
    expect(value.style.getPropertyPriority("min-width")).toBe("important");
    expect(value.style.getPropertyValue("width")).toBe("");
    expect(value.style.getPropertyValue("white-space")).toBe("");

    for (const property of [
      "width",
      "min-width",
      "max-width",
      "white-space",
      "display",
    ]) {
      expect([property, header.style.getPropertyValue(property)]).toEqual([
        property,
        "",
      ]);
    }

    expect(header.style.paddingLeft).toBe("24px");
    expect(header.style.paddingRight).toBe("12px");
  });

  test("the column's least-width floor (min-width) and its cap (max-width) do not hold a value back while it is read", () => {
    buildTable(TABLE);

    const value: HTMLElement = document.querySelector(
      "tbody tr td:nth-child(2) > div",
    ) as HTMLElement;
    let readWith: {
      minWidth: string;
      maxWidth: string;
      whiteSpace: string;
    } | null = null;
    const original: typeof Element.prototype.getBoundingClientRect =
      Element.prototype.getBoundingClientRect;

    jest
      .spyOn(value, "getBoundingClientRect")
      .mockImplementation((): DOMRect => {
        readWith = {
          minWidth: value.style.minWidth,
          maxWidth: value.style.maxWidth,
          whiteSpace: value.style.whiteSpace,
        };

        return original.call(value);
      });

    measureTableColumn({ headerCell: headerCell(1) });

    expect(readWith).not.toBeNull();
    // jsdom keeps "0" as written; a browser reads it "0px".
    expect(["0", "0px"]).toContain(readWith!.minWidth);
    expect(readWith!.maxWidth).toBe("none");
    expect(readWith!.whiteSpace).toBe("nowrap");
  });

  test("a part laid out in the line (a span) is read as an inline-block, which can take a width", () => {
    buildTable(`
      <table>
        <thead><tr><th style="padding: 0 12px" data-now="200"><span data-min="40" data-max="90">Status</span></th></tr></thead>
        <tbody><tr><td style="padding: 0 12px" data-now="200"><span data-max="130">Operational</span></td></tr></tbody>
      </table>`);

    jest
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element: Element): CSSStyleDeclaration => {
        const tag: string = element.tagName;
        const padding: string = tag === "TH" || tag === "TD" ? "12px" : "0px";

        return {
          display: tag === "SPAN" ? "inline" : "block",
          direction: "ltr",
          paddingLeft: padding,
          paddingRight: padding,
          borderLeftWidth: "0px",
          borderRightWidth: "0px",
        } as unknown as CSSStyleDeclaration;
      });

    const measurement: ColumnMeasurement = measureTableColumn({
      headerCell: headerCell(0),
    });

    expect(measurement.headerMinContentWidth).toBe(40 + 24);
    expect(measurement.headerMaxContentWidth).toBe(90 + 24);
    expect(measurement.widestValueWidth).toBe(130);
    expect(measurement.cellPaddingWidth).toBe(24);

    const spanReadings: Array<string> = widths.readings
      .filter((reading: { element: Element }): boolean => {
        return reading.element.tagName === "SPAN";
      })
      .map((reading: { display: string }): string => {
        return reading.display;
      });

    expect(spanReadings.length).toBeGreaterThan(0);
    expect(new Set(spanReadings)).toEqual(new Set(["inline-block"]));

    // And given back its own display after.
    for (const span of Array.from(document.querySelectorAll("span"))) {
      expect((span as HTMLElement).style.display).toBe("");
    }
  });

  test("a cell of loose words is read as a whole, on one line, through a range over its words", () => {
    buildTable(`
      <table>
        <thead><tr><th data-now="100">Plain header words</th></tr></thead>
        <tbody>
          <tr><td data-now="100">twelve words that a hand-built table writes into its cell</td></tr>
        </tbody>
      </table>`);

    const cell: HTMLTableCellElement = document.querySelector(
      "tbody td",
    ) as HTMLTableCellElement;
    const header: HTMLTableCellElement = headerCell(0);
    let whiteSpaceWhileRead: string = "";

    const createRange: () => Range = (): Range => {
      let node: Node | null = null;

      return {
        selectNodeContents: (target: Node): void => {
          node = target;

          if (target === cell) {
            whiteSpaceWhileRead = cell.style.whiteSpace;
          }
        },
        getBoundingClientRect: (): DOMRect => {
          return {
            width: node === header ? 140 : 380,
          } as DOMRect;
        },
      } as unknown as Range;
    };

    jest
      .spyOn(document, "createRange")
      .mockImplementation(createRange as () => Range);

    const measurement: ColumnMeasurement = measureTableColumn({
      headerCell: header,
    });

    expect(measurement.headerMinContentWidth).toBe(140);
    expect(measurement.headerMaxContentWidth).toBe(140);
    expect(measurement.widestValueWidth).toBe(380);
    expect(whiteSpaceWhileRead).toBe("nowrap");
    expect(cell.style.whiteSpace).toBe("");
  });

  test(`a long list is read at its top: ${COLUMN_MEASURE_MAX_ROWS} rows, however many it draws`, () => {
    const rows: Array<string> = [];

    for (let index: number = 0; index < COLUMN_MEASURE_MAX_ROWS + 50; index++) {
      // The widest value is past the rows read: it is not read.
      const max: number =
        index === COLUMN_MEASURE_MAX_ROWS + 10 ? 900 : 100 + (index % 7);

      rows.push(
        `<tr><td data-now="100"><div data-max="${max}">v</div></td></tr>`,
      );
    }

    buildTable(
      `<table><thead><tr><th data-now="100"><div data-min="10" data-max="10">H</div></th></tr></thead><tbody>${rows.join("")}</tbody></table>`,
    );

    const measurement: ColumnMeasurement = measureTableColumn({
      headerCell: headerCell(0),
    });

    expect(COLUMN_MEASURE_MAX_ROWS).toBe(100);
    expect(measurement.widestValueWidth).toBe(106);
    expect(
      measureTableColumn({ headerCell: headerCell(0), maxRows: 1000 })
        .widestValueWidth,
    ).toBe(900);
  });

  test("a header cell outside any table reads its own header and no values", () => {
    document.body.innerHTML =
      '<div><table><thead><tr><th data-now="80"><div data-min="30" data-max="60">Lone</div></th></tr></thead></table></div>';

    expect(measureTableColumn({ headerCell: headerCell(0) })).toEqual({
      currentWidth: 80,
      headerMinContentWidth: 30,
      headerMaxContentWidth: 60,
      widestValueWidth: 0,
      cellPaddingWidth: 0,
      leastDrawnWidth: 0,
    });
  });
});

describe("the least a column is drawn at once it is sized", () => {
  const scopedTable: () => HTMLTableElement = (): HTMLTableElement => {
    const table: HTMLTableElement = buildTable(TABLE);

    table.setAttribute("data-column-widths-scope", "r9");
    headerCell(1).setAttribute("data-least", "132");
    headerCell(1).style.setProperty("width", "240px");

    // A page's own cell: words loose in it, in no box of their own.
    const cell: HTMLTableCellElement = table.tBodies[0]!.rows[0]!
      .cells[1] as HTMLTableCellElement;

    cell.innerHTML = "A rather long incident name";

    return table;
  };

  test("a column whose every value is drawn in a box of its own is not read again: its values ask for no width once it is sized", () => {
    const table: HTMLTableElement = buildTable(TABLE);

    table.setAttribute("data-column-widths-scope", "r9");
    headerCell(1).setAttribute("data-least", "132");

    const appendChild: ReturnType<typeof jest.spyOn> = jest.spyOn(
      document.head,
      "appendChild",
    );

    expect(
      measureTableColumn({
        headerCell: headerCell(1),
        kind: ColumnWidthKind.Text,
      }).leastDrawnWidth,
    ).toBe(0);
    expect(appendChild).not.toHaveBeenCalled();
  });

  test("nor is a column kept whole: it is never narrower than its widest value", () => {
    scopedTable();

    expect(
      measureTableColumn({
        headerCell: headerCell(1),
        kind: ColumnWidthKind.Whole,
      }).leastDrawnWidth,
    ).toBe(0);
  });

  test("is read with a sized column's rules written for it, its header cell given no width and the table as wide as its columns", () => {
    const table: HTMLTableElement = scopedTable();
    const written: Array<string> = [];
    const appendChild: typeof document.head.appendChild =
      document.head.appendChild.bind(document.head);

    jest
      .spyOn(document.head, "appendChild")
      .mockImplementation(<T extends Node>(node: T): T => {
        written.push(node.textContent || "");
        // The table as it is while the rules are on the page.
        written.push(`table width: ${table.style.getPropertyValue("width")}`);

        return appendChild(node);
      });

    const measurement: ColumnMeasurement = measureTableColumn({
      headerCell: headerCell(1),
      kind: ColumnWidthKind.Text,
    });

    expect(measurement.leastDrawnWidth).toBe(132);
    // The rules of a sized column, for this one's place in the row.
    expect(written[0]).toContain(
      'table[data-column-widths-scope="r9"] > tbody > tr > td:nth-child(2) > div { max-width: none; min-width: 0; contain: inline-size; }',
    );
    expect(
      widths.readings.some(
        (reading: { element: Element; width: string }): boolean => {
          return reading.element === headerCell(1) && reading.width === "0px";
        },
      ),
    ).toBe(true);
  });

  test("gives everything back: no rules left on the page, the table and the header cell as they were", () => {
    const table: HTMLTableElement = scopedTable();

    measureTableColumn({
      headerCell: headerCell(1),
      kind: ColumnWidthKind.Text,
    });

    expect(document.head.querySelectorAll("style")).toHaveLength(0);
    expect(table.style.getPropertyValue("width")).toBe("");
    expect(table.style.getPropertyValue("min-width")).toBe("");
    expect(headerCell(1).style.getPropertyValue("width")).toBe("240px");
    expect(headerCell(1).style.getPropertyValue("min-width")).toBe("");
    expect(headerCell(1).style.getPropertyValue("max-width")).toBe("");
  });

  test("a value's box is read past its containment: its whole width, not none", () => {
    buildTable(TABLE);

    const value: HTMLElement = document.querySelectorAll(
      "tbody td div",
    )[1] as HTMLElement;

    value.style.setProperty("contain", "inline-size");

    expect(
      measureTableColumn({ headerCell: headerCell(1) }).widestValueWidth,
    ).toBe(310);
    // ...and keeps its own after.
    expect(value.style.getPropertyValue("contain")).toBe("inline-size");
  });
});

describe("a cell's padding", () => {
  test("its start and end padding and borders", () => {
    document.body.innerHTML =
      '<table><tbody><tr><td style="padding-left: 24px; padding-right: 12px; border-left: 1px solid; border-right: 2px solid">x</td></tr></tbody></table>';

    expect(getHorizontalPadding(document.querySelector("td")!)).toBe(39);
  });
});

describe("a width written straight onto a header cell while its edge is dragged", () => {
  test("as wide as that, no narrower and no wider - a column of dates no narrower", () => {
    document.body.innerHTML =
      "<table><thead><tr><th></th></tr></thead></table>";

    const th: HTMLElement = document.querySelector("th") as HTMLElement;

    writeHeaderCellWidth(th, 212.4, ColumnWidthKind.Text);
    expect([th.style.width, th.style.minWidth, th.style.maxWidth]).toEqual([
      "212px",
      "212px",
      "212px",
    ]);

    writeHeaderCellWidth(th, 180, ColumnWidthKind.Whole);
    expect([th.style.width, th.style.minWidth, th.style.maxWidth]).toEqual([
      "180px",
      "180px",
      "",
    ]);
  });

  test("and the width it had put back as it was", () => {
    document.body.innerHTML =
      '<table><thead><tr><th style="width: 90px; min-width: 90px"></th></tr></thead></table>';

    const th: HTMLElement = document.querySelector("th") as HTMLElement;
    const saved: SavedHeaderCellWidth = readHeaderCellWidth(th);

    writeHeaderCellWidth(th, 300, ColumnWidthKind.Text);
    restoreHeaderCellWidth(th, saved);

    expect([th.style.width, th.style.minWidth, th.style.maxWidth]).toEqual([
      "90px",
      "90px",
      "",
    ]);
  });
});
