import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  getWholeValueWidths,
  keepWholeWhatFits,
  releaseWholeValues,
} from "../../../../UI/Components/Table/useTableScrollState";
import {
  TABLE_VALUE_GIVE_ATTRIBUTE,
  TABLE_VALUE_WHOLE_ATTRIBUTE,
  TABLE_VALUE_WHOLE_CLASS_NAME,
  TABLE_VALUE_WHOLE_WIDTH_PROPERTY,
} from "../../../../UI/Components/Table/TableLayout";
import { getTableCellContentClassName } from "../../../../UI/Components/Table/CellClassName";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * Only what has to be cut short is (useTableScrollState's
 * keepWholeWhatFits): once a table fits, the values cut short that could be
 * whole are made whole, a column at a time, the one needing the least room
 * first - kept whole only while the table still fits and nothing else is
 * cut shorter for it.
 *
 * "Person names in the Security case lists still cut at 1280 in German and
 * Russian - the fix belongs in the shared table's give-way, not a page
 * floor": beside a case's two lines of prose the person it was assigned to
 * read "Grace Hop..." while the prose had room to wrap a line more. A table
 * shares its room by how long its values are, not by what they are.
 *
 * jsdom lays nothing out, so each value's width is worked out here from what
 * it carries, as the browser would for these tests; Chromium measures the
 * real thing (packages/E2E/ModelTables).
 */

afterEach(() => {
  document.body.innerHTML = "";
});

interface FakeValue {
  // Its width whole, and its width cut short (given way, or by itself).
  whole: number;
  cut: number;
  isGiven?: boolean | undefined;
  // A name set free (data-fill) rather than a value.
  column: number;
}

interface Layout {
  values: Array<HTMLElement>;
  names: Array<HTMLElement>;
  // The table's width now, from what each value carries.
  tableWidth: () => number;
}

const rect: (width: number) => DOMRect = (width: number): DOMRect => {
  return {
    width: width,
    height: 24,
    top: 0,
    left: 0,
    right: width,
    bottom: 24,
    x: 0,
    y: 0,
    toJSON: (): unknown => {
      return {};
    },
  } as DOMRect;
};

/*
 * A row of cells, one value in each: a value is as wide as it is whole when
 * it is held whole or neither given nor cut, and as its cut width
 * otherwise. Names take what the values leave, never under their floor.
 */
const layOut: (data: {
  values: Array<FakeValue>;
  // The room the row's other cells take.
  base: number;
  // Self-cut values: narrower than whole without being given way.
  selfCut?: Array<number> | undefined;
  name?: { width: number; floor: number } | undefined;
  box: number;
}) => Layout = (data: {
  values: Array<FakeValue>;
  base: number;
  selfCut?: Array<number> | undefined;
  name?: { width: number; floor: number } | undefined;
  box: number;
}): Layout => {
  const table: HTMLTableElement = document.createElement("table");
  const row: HTMLTableRowElement = table.insertRow();
  const values: Array<HTMLElement> = [];
  const names: Array<HTMLElement> = [];

  const widthOf: (index: number) => number = (index: number): number => {
    const value: HTMLElement = values[index] as HTMLElement;
    const fake: FakeValue = data.values[index] as FakeValue;

    if (value.getAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE) === "true") {
      return fake.whole;
    }

    if (
      value.hasAttribute(TABLE_VALUE_GIVE_ATTRIBUTE) ||
      (data.selfCut || []).includes(index)
    ) {
      return fake.cut;
    }

    return fake.whole;
  };

  const valuesWidth: () => number = (): number => {
    return data.values.reduce(
      (sum: number, _value: FakeValue, index: number) => {
        return sum + widthOf(index);
      },
      0,
    );
  };

  const nameWidth: () => number = (): number => {
    if (!data.name) {
      return 0;
    }

    // The name takes the room left, down to its floor.
    const left: number = data.box - data.base - valuesWidth();

    return Math.max(data.name.floor, Math.min(data.name.width, left));
  };

  if (data.name) {
    const cell: HTMLTableCellElement = row.insertCell();
    const name: HTMLDivElement = document.createElement("div");

    name.getBoundingClientRect = (): DOMRect => {
      return rect(nameWidth());
    };
    cell.appendChild(name);
    names.push(name);
  }

  const cells: Map<number, HTMLTableCellElement> = new Map();

  data.values.forEach((fake: FakeValue, index: number) => {
    let cell: HTMLTableCellElement | undefined = cells.get(fake.column);

    if (!cell) {
      cell = row.insertCell();
      cells.set(fake.column, cell);
    }

    const value: HTMLDivElement = document.createElement("div");

    if (fake.isGiven) {
      value.setAttribute(TABLE_VALUE_GIVE_ATTRIBUTE, "line");
    }

    value.getBoundingClientRect = (): DOMRect => {
      return rect(widthOf(index));
    };
    cell.appendChild(value);
    values.push(value);
  });

  document.body.appendChild(table);

  return {
    values: values,
    names: names,
    tableWidth: (): number => {
      return data.base + valuesWidth() + nameWidth();
    },
  };
};

const fitsIn: (layout: Layout, box: number) => () => boolean = (
  layout: Layout,
  box: number,
): (() => boolean) => {
  return (): boolean => {
    return layout.tableWidth() <= box;
  };
};

describe("keepWholeWhatFits", () => {
  test("a person's name cut short by itself beside room to spare is made whole", () => {
    // An assignee "Grace Hop..." (140px whole, 110 cut), 60px to spare.
    const layout: Layout = layOut({
      values: [{ whole: 140, cut: 110, column: 1 }],
      selfCut: [0],
      base: 700,
      box: 900,
    });

    keepWholeWhatFits({
      values: layout.values,
      wholeWidths: [140],
      names: [],
      fitsNow: fitsIn(layout, 900),
    });

    expect(layout.values[0]).toHaveAttribute(
      TABLE_VALUE_WHOLE_ATTRIBUTE,
      "true",
    );
    expect(
      layout.values[0]!.style.getPropertyValue(
        TABLE_VALUE_WHOLE_WIDTH_PROPERTY,
      ),
    ).toBe("140px");
  });

  test("the column needing the least room is made whole first; one that would not fit stays cut", () => {
    const layout: Layout = layOut({
      values: [
        // A list of resources needing 120px more.
        { whole: 280, cut: 160, isGiven: true, column: 1 },
        // A name needing 30px more.
        { whole: 160, cut: 130, isGiven: true, column: 2 },
      ],
      base: 560,
      box: 900,
    });

    // 560 + 160 + 130 = 850: 50px to spare - room for the name, not the list.
    keepWholeWhatFits({
      values: layout.values,
      wholeWidths: [280, 160],
      names: [],
      fitsNow: fitsIn(layout, 900),
    });

    expect(layout.values[1]).toHaveAttribute(
      TABLE_VALUE_WHOLE_ATTRIBUTE,
      "true",
    );
    expect(layout.values[1]).not.toHaveAttribute(TABLE_VALUE_GIVE_ATTRIBUTE);
    // The list keeps the way it gave.
    expect(layout.values[0]).not.toHaveAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE);
    expect(layout.values[0]).toHaveAttribute(
      TABLE_VALUE_GIVE_ATTRIBUTE,
      "line",
    );
    expect(
      layout.values[0]!.style.getPropertyValue(
        TABLE_VALUE_WHOLE_WIDTH_PROPERTY,
      ),
    ).toBe("");
    expect(layout.tableWidth()).toBeLessThanOrEqual(900);
  });

  test("a column's values are made whole together, by their cell's place in the row", () => {
    const layout: Layout = layOut({
      values: [
        { whole: 150, cut: 128, isGiven: true, column: 1 },
        { whole: 140, cut: 128, isGiven: true, column: 1 },
      ],
      base: 600,
      box: 900,
    });

    keepWholeWhatFits({
      values: layout.values,
      wholeWidths: [150, 140],
      names: [],
      fitsNow: fitsIn(layout, 900),
    });

    for (const value of layout.values) {
      expect(value).toHaveAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE, "true");
      expect(value).not.toHaveAttribute(TABLE_VALUE_GIVE_ATTRIBUTE);
    }
  });

  test("a value is never made whole by cutting the row's name shorter", () => {
    // The name has 200px and is whole at 200; the value would take 40 of it.
    const layout: Layout = layOut({
      values: [{ whole: 168, cut: 128, isGiven: true, column: 1 }],
      name: { width: 200, floor: 160 },
      base: 500,
      box: 828,
    });

    keepWholeWhatFits({
      values: layout.values,
      wholeWidths: [168],
      names: layout.names,
      fitsNow: fitsIn(layout, 828),
    });

    expect(layout.values[0]).not.toHaveAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE);
    expect(layout.values[0]).toHaveAttribute(
      TABLE_VALUE_GIVE_ATTRIBUTE,
      "line",
    );
  });

  test("nor by cutting a value that is whole shorter", () => {
    const layout: Layout = layOut({
      values: [
        // Whole, but it would be cut if the other took its room.
        { whole: 140, cut: 100, column: 1 },
        { whole: 180, cut: 128, isGiven: true, column: 2 },
      ],
      base: 600,
      box: 870,
    });

    // The first is cut as soon as the second is held whole.
    const firstWidth: () => DOMRect = layout.values[0]!.getBoundingClientRect;

    layout.values[0]!.getBoundingClientRect = (): DOMRect => {
      return layout.values[1]!.getAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE)
        ? rect(100)
        : firstWidth();
    };

    keepWholeWhatFits({
      values: layout.values,
      wholeWidths: [140, 180],
      names: [],
      fitsNow: (): boolean => {
        return true;
      },
    });

    expect(layout.values[1]).not.toHaveAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE);
    expect(layout.values[1]).toHaveAttribute(
      TABLE_VALUE_GIVE_ATTRIBUTE,
      "line",
    );
  });

  test("nothing cut short: nothing is touched, nothing is read twice", () => {
    let reads: number = 0;
    const layout: Layout = layOut({
      values: [{ whole: 120, cut: 120, column: 1 }],
      base: 300,
      box: 900,
    });

    keepWholeWhatFits({
      values: layout.values,
      wholeWidths: [120],
      names: [],
      fitsNow: (): boolean => {
        reads++;
        return true;
      },
    });

    expect(reads).toBe(0);
    expect(layout.values[0]).not.toHaveAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE);
  });
});

describe("holding a value whole", () => {
  test("is a class on the value, read from a width it carries: a column a person sized overrules it", () => {
    expect(TABLE_VALUE_WHOLE_ATTRIBUTE).toBe("data-whole");
    expect(TABLE_VALUE_WHOLE_WIDTH_PROPERTY).toBe("--ou-table-whole-width");
    expect(TABLE_VALUE_WHOLE_CLASS_NAME).toBe(
      "data-[whole=true]:min-w-[var(--ou-table-whole-width)]",
    );

    // Every value that may give way carries it; a date never does.
    expect(
      getTableCellContentClassName({
        title: "Assignee",
        type: FieldType.Element,
      }),
    ).toContain(TABLE_VALUE_WHOLE_CLASS_NAME);
    expect(
      getTableCellContentClassName({ title: "Declared", type: FieldType.Date }),
    ).not.toContain(TABLE_VALUE_WHOLE_CLASS_NAME);
  });

  test("releaseWholeValues lets go of every value held, and of nothing else", () => {
    const held: HTMLDivElement = document.createElement("div");
    const free: HTMLDivElement = document.createElement("div");

    held.setAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE, "true");
    held.style.setProperty(TABLE_VALUE_WHOLE_WIDTH_PROPERTY, "140px");
    free.style.setProperty("color", "red");

    releaseWholeValues([held, free]);

    expect(held).not.toHaveAttribute(TABLE_VALUE_WHOLE_ATTRIBUTE);
    expect(held.style.getPropertyValue(TABLE_VALUE_WHOLE_WIDTH_PROPERTY)).toBe(
      "",
    );
    expect(free.style.getPropertyValue("color")).toBe("red");
  });

  test("getWholeValueWidths reads each value's width in whole pixels, and leaves no width on it", () => {
    const value: HTMLDivElement = document.createElement("div");
    const widths: Array<string> = [];

    /*
     * jsdom keeps no max-content width (it ignores the keyword), so what
     * the value is read at is recorded as it is set.
     */
    const style: CSSStyleDeclaration = value.style;
    const setWidth: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(style), "width");

    Object.defineProperty(style, "width", {
      configurable: true,
      get: (): string => {
        return setWidth?.get?.call(style) as string;
      },
      set: (width: string): void => {
        widths.push(width);
        setWidth?.set?.call(style, width);
      },
    });

    value.getBoundingClientRect = (): DOMRect => {
      return rect(212.4);
    };

    expect(getWholeValueWidths([value])).toEqual([213]);
    expect(widths).toEqual(["max-content"]);
    expect(value.style.getPropertyValue("width")).toBe("");
  });
});
