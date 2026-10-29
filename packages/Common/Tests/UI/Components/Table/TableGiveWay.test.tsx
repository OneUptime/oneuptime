import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, useRef } from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import Column from "../../../../UI/Components/Table/Types/Column";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  getTableCellContentClassName,
  isGivingValueColumn,
} from "../../../../UI/Components/Table/CellClassName";
import {
  TABLE_CELL_MAX_WIDTH_CLASS_NAME,
  TABLE_HEADER_CONTENT_WRAP_CLASS_NAME,
  TABLE_HEADER_WRAP_ATTRIBUTE,
  TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME,
  TABLE_SHRINKABLE_ATTRIBUTE,
  TABLE_VALUE_ATTRIBUTE,
  TABLE_VALUE_GIVE_ATTRIBUTE,
  TABLE_VALUE_GIVE_CLASS_NAME,
  TABLE_VALUE_GIVE_FLOOR_IN_PX,
} from "../../../../UI/Components/Table/TableLayout";
import useTableScrollState, {
  TABLE_FILL_ATTRIBUTE,
  TABLE_GIVE_WAY_READINGS,
  TABLE_NAME_ATTRIBUTE,
  TableScrollState,
  getValueGiveKind,
} from "../../../../UI/Components/Table/useTableScrollState";
import Pill from "../../../../UI/Components/Pill/Pill";
import TableColumnListComponent from "../../../../UI/Components/TableColumnList/TableColumnListComponent";
import {
  TableCardContext,
  TableCellContext,
} from "../../../../UI/Components/Table/TableCellContext";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Color from "../../../../Types/Color";
import GenericObject from "../../../../Types/GenericObject";
import IconProp from "../../../../Types/Icon/IconProp";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";

/*
 * "Tables that run past their card": beside a side menu at 1280px a card is
 * about 940px wide, and table after table - the incidents and alerts
 * lists, Runners, Twilio configs, threat intel feeds, AI rules in German
 * and Russian - ran its rows under the sticky Actions column for a header
 * of two words or a name 30px too long.
 *
 * A table now gives way before it scrolls (useTableScrollState): its names
 * as before, then its header's names break between their words, then its
 * other long values are cut short a little more, never below 8rem. Only a
 * table too wide even so scrolls, with everything back as it was.
 *
 * jsdom lays nothing out, so the widths are handed to the elements here
 * and the classes and attributes are asserted; what they draw is measured
 * in Chromium by the ModelTables offline suite (packages/E2E/ModelTables,
 * "a table gives way before it scrolls").
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

type TokensFunction = (className: string) => Array<string>;

const tokens: TokensFunction = (className: string): Array<string> => {
  return className.split(" ").filter((token: string): boolean => {
    return token.length > 0;
  });
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1024,
  });
});

describe("the classes a table gives way with", () => {
  test("a header's names break between words only while the table says so", () => {
    expect(TABLE_HEADER_WRAP_ATTRIBUTE).toBe("data-wrap-headers");
    expect(tokens(TABLE_HEADER_CONTENT_WRAP_CLASS_NAME)).toEqual([
      "[[data-wrap-headers=true]_&]:whitespace-normal",
    ]);
  });

  test("a value's classes apply only while it carries data-give, and never below 8rem", () => {
    expect(TABLE_VALUE_GIVE_ATTRIBUTE).toBe("data-give");
    expect(TABLE_VALUE_ATTRIBUTE).toBe("data-table-value");
    expect(TABLE_VALUE_GIVE_FLOOR_IN_PX).toBe(128);

    for (const token of tokens(TABLE_VALUE_GIVE_CLASS_NAME)) {
      expect([
        token,
        token.startsWith("data-[give=line]:") ||
          token.startsWith("data-[give=box]:") ||
          token.startsWith("[&[data-give=box]>*]:"),
      ]).toEqual([token, true]);
    }

    // The floor, as many pixels as the hook compares with.
    expect(TABLE_VALUE_GIVE_CLASS_NAME).toContain(
      "data-[give=line]:min-w-[8rem]",
    );
    expect(TABLE_VALUE_GIVE_CLASS_NAME).toContain(
      "data-[give=box]:min-w-[8rem]",
    );
    expect(8 * 16).toBe(TABLE_VALUE_GIVE_FLOOR_IN_PX);
  });

  test("a line of text breaks anywhere for the measuring and shows its first line to the column's end, keeping the table's cap", () => {
    const line: Array<string> = tokens(TABLE_VALUE_GIVE_CLASS_NAME)
      .filter((token: string): boolean => {
        return token.startsWith("data-[give=line]:");
      })
      .map((token: string): string => {
        return token.slice("data-[give=line]:".length);
      });

    /*
     * Between any two letters (break-all), not only between words: the
     * first line runs to the column's end, and the "..." comes where the
     * room does - "grace@acme-commerce.examp...", never "grace@acme-..." in
     * a column with room for twice the letters.
     */
    expect(line).toEqual([
      "min-w-[8rem]",
      "whitespace-normal",
      "break-all",
      "line-clamp-1",
    ]);
    expect(line).not.toContain("[overflow-wrap:anywhere]");
    // Unlike a row's name, it does not lift the 20rem cap.
    expect(line).not.toContain("max-w-none");
  });

  test("a box is a grid of one column its parts shrink in, each as wide as it is or the column", () => {
    expect(tokens(TABLE_VALUE_GIVE_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "data-[give=box]:grid",
        "data-[give=box]:grid-cols-1",
        "data-[give=box]:justify-items-start",
        "[&[data-give=box]>*]:min-w-0",
        "[&[data-give=box]>*]:max-w-full",
      ]),
    );
  });
});

type MakeColumnFunction = (
  type: FieldType,
  extra?: Partial<Column<GenericObject>>,
) => Column<GenericObject>;

const makeColumn: MakeColumnFunction = (
  type: FieldType,
  extra?: Partial<Column<GenericObject>>,
): Column<GenericObject> => {
  return { title: "Value", type: type, ...(extra || {}) };
};

describe("which columns give way", () => {
  const GIVING: Array<FieldType> = [
    FieldType.Text,
    FieldType.Element,
    FieldType.Entity,
    FieldType.EntityArray,
    FieldType.ObjectID,
    FieldType.URL,
    FieldType.Email,
    FieldType.Hostname,
    FieldType.Name,
  ];

  test.each(GIVING)(
    "a %s column's values may be cut short",
    (type: FieldType) => {
      expect(isGivingValueColumn(makeColumn(type), false)).toBe(true);
      expect(tokens(getTableCellContentClassName(makeColumn(type)))).toEqual(
        expect.arrayContaining(tokens(TABLE_VALUE_GIVE_CLASS_NAME)),
      );
    },
  );

  const KEPT_WHOLE: Array<FieldType> = [
    FieldType.Date,
    FieldType.DateTime,
    FieldType.Number,
    FieldType.Percent,
    FieldType.Minutes,
    FieldType.USDCents,
    FieldType.Port,
    FieldType.Boolean,
    FieldType.Color,
    FieldType.Icon,
    FieldType.Actions,
  ];

  test.each(KEPT_WHOLE)(
    "a %s column says what it says only whole",
    (type: FieldType) => {
      expect(isGivingValueColumn(makeColumn(type), false)).toBe(false);
      expect(getTableCellContentClassName(makeColumn(type))).not.toContain(
        "data-[give=",
      );
    },
  );

  test("the row's name gives way by its own fill, not this", () => {
    const name: Column<GenericObject> = makeColumn(FieldType.Text);

    expect(isGivingValueColumn(name, true)).toBe(false);

    const classes: string = getTableCellContentClassName(name, {
      isPrimaryColumn: true,
    });

    expect(classes).toContain(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME);
    expect(classes).not.toContain("data-[give=");
  });

  test("a column of prose wraps already, and a column a page sized keeps its size", () => {
    expect(
      isGivingValueColumn(
        makeColumn(FieldType.Text, { wrapContent: true }),
        false,
      ),
    ).toBe(false);
    expect(
      isGivingValueColumn(
        makeColumn(FieldType.Text, { contentClassName: "max-w-[10rem]" }),
        false,
      ),
    ).toBe(false);
    expect(
      isGivingValueColumn(
        makeColumn(FieldType.Text, { contentClassName: "min-w-[12rem]" }),
        false,
      ),
    ).toBe(false);
    expect(
      isGivingValueColumn(
        makeColumn(FieldType.Text, { contentClassName: "font-mono" }),
        false,
      ),
    ).toBe(true);
  });

  test("a giving value keeps the table's 20rem cap and its clip", () => {
    const classes: Array<string> = tokens(
      getTableCellContentClassName(makeColumn(FieldType.Text)),
    );

    expect(classes).toContain(TABLE_CELL_MAX_WIDTH_CLASS_NAME);
    expect(classes).toContain("overflow-x-clip");
    expect(classes).toContain("text-ellipsis");
  });
});

describe("how a value would be cut short", () => {
  type ValueFunction = (markup: string, width: number) => HTMLElement;

  const value: ValueFunction = (markup: string, width: number): HTMLElement => {
    const element: HTMLDivElement = document.createElement("div");
    element.innerHTML = markup;
    Object.defineProperty(element, "scrollWidth", {
      configurable: true,
      value: width,
    });
    document.body.appendChild(element);
    return element;
  };

  test("a line of text wider than the floor: as a line", () => {
    expect(getValueGiveKind(value("web-prod-03.eu-west-1.internal", 210))).toBe(
      "line",
    );
    expect(
      getValueGiveKind(
        value('<a href="/x"><span>Customer Portal Production</span></a>', 190),
      ),
    ).toBe("line");
  });

  test("a value no wider than the floor is never cut short", () => {
    expect(getValueGiveKind(value("Checkout API", 96))).toBeNull();
    expect(
      getValueGiveKind(
        value("Exactly the floor", TABLE_VALUE_GIVE_FLOOR_IN_PX),
      ),
    ).toBeNull();
  });

  test("a list or a pill, whose words end in '...' of their own: as a box", () => {
    expect(
      getValueGiveKind(
        value(
          `<div ${TABLE_SHRINKABLE_ATTRIBUTE}="true"><div>oneuptime-test - High Node Memory Utilization</div></div>`,
          300,
        ),
      ),
    ).toBe("box");
    expect(
      getValueGiveKind(
        value(
          `<span ${TABLE_SHRINKABLE_ATTRIBUTE}="true" style="display: inline-flex"><span>SEV-1 Customer Impact</span></span>`,
          180,
        ),
      ),
    ).toBe("box");
  });

  test("anything else would only be clipped: a row of avatars, a dot beside words, a box beside a pill", () => {
    expect(
      getValueGiveKind(
        value(
          '<div style="display: flex"><img alt="" src="/a.png"><img alt="" src="/b.png"><span>+3</span></div>',
          200,
        ),
      ),
    ).toBeNull();
    expect(
      getValueGiveKind(
        value(
          `<span ${TABLE_SHRINKABLE_ATTRIBUTE}="true" style="display: inline-flex">Critical</span><div>and a note</div>`,
          220,
        ),
      ),
    ).toBeNull();
  });
});

/*
 * A box, and a table whose width follows what has given way - its names
 * set free, its header's names wrapping, its values cut short - as the
 * browser's layout would, as far as these tests need it. Every reading of
 * the table's width is recorded with what had given way then.
 */
interface Giving {
  fill: boolean;
  wrap: boolean;
  give: boolean;
}

interface ProbeProps {
  boxWidth: number;
  widthFor: (giving: Giving) => number;
  values: Array<{ markup: string; width: number }>;
  readings: Array<Giving>;
  onState: (state: TableScrollState) => void;
  // How wide the row's name is as its words: 216px unless a test says.
  nameWidth?: number | undefined;
}

const rect: (width: number) => DOMRect = (width: number): DOMRect => {
  return {
    width: width,
    height: 40,
    top: 0,
    left: 0,
    right: width,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: (): unknown => {
      return {};
    },
  } as DOMRect;
};

function Probe(props: ProbeProps): ReactElement {
  const scrollRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const tableRef: React.MutableRefObject<HTMLTableElement | null> =
    useRef<HTMLTableElement | null>(null);

  const state: TableScrollState = useTableScrollState({
    scrollRef: scrollRef as React.RefObject<HTMLElement>,
    tableRef: tableRef as React.RefObject<HTMLElement>,
    watch: [props.boxWidth, props.widthFor],
  });

  props.onState(state);

  return (
    <div
      ref={(element: HTMLDivElement | null) => {
        scrollRef.current = element;
        if (element) {
          element.getBoundingClientRect = (): DOMRect => {
            return rect(props.boxWidth);
          };
        }
      }}
    >
      <table
        data-testid="table"
        ref={(element: HTMLTableElement | null) => {
          tableRef.current = element;
          if (element) {
            element.getBoundingClientRect = (): DOMRect => {
              const giving: Giving = {
                fill: Boolean(
                  element.querySelector(`[${TABLE_FILL_ATTRIBUTE}="true"]`),
                ),
                wrap:
                  element.getAttribute(TABLE_HEADER_WRAP_ATTRIBUTE) === "true",
                give: Boolean(
                  element.querySelector(`[${TABLE_VALUE_GIVE_ATTRIBUTE}]`),
                ),
              };

              props.readings.push(giving);

              return rect(props.widthFor(giving));
            };
          }
        }}
      >
        <tbody>
          <tr>
            <td>
              <div
                data-testid="name"
                {...{ [TABLE_NAME_ATTRIBUTE]: "true" }}
                ref={(element: HTMLDivElement | null) => {
                  if (element) {
                    Object.defineProperty(element, "scrollWidth", {
                      configurable: true,
                      value: props.nameWidth ?? 216,
                    });
                  }
                }}
              >
                Customer-Facing Status Page
              </div>
            </td>
            {props.values.map(
              (
                value: { markup: string; width: number },
                index: number,
              ): ReactElement => {
                return (
                  <td key={index}>
                    <div
                      data-testid={`value-${index}`}
                      {...{ [TABLE_VALUE_ATTRIBUTE]: "true" }}
                      ref={(element: HTMLDivElement | null) => {
                        if (element) {
                          Object.defineProperty(element, "scrollWidth", {
                            configurable: true,
                            value: value.width,
                          });
                        }
                      }}
                      dangerouslySetInnerHTML={{ __html: value.markup }}
                    />
                  </td>
                );
              },
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface ProbeResult {
  states: Array<TableScrollState>;
  readings: Array<Giving>;
}

const VALUES: Array<{ markup: string; width: number }> = [
  // A host's name, wider than the floor: cut short as a line.
  { markup: "web-prod-03.eu-west-1.internal", width: 214 },
  // A count, no wider than the floor: never cut short.
  { markup: "12", width: 18 },
  // A list of resources: cut short as a box.
  {
    markup: `<div ${TABLE_SHRINKABLE_ATTRIBUTE}="true"><div>oneuptime-test - High Node Memory Utilization</div></div>`,
    width: 320,
  },
  // Owners' avatars, with their initials: never cut short, only clipped.
  {
    markup:
      '<div style="display: flex"><span style="display: inline-flex">AL</span><span style="display: inline-flex">GH</span></div>',
    width: 160,
  },
];

const renderProbe: (
  boxWidth: number,
  widthFor: (giving: Giving) => number,
  nameWidth?: number,
) => ProbeResult = (
  boxWidth: number,
  widthFor: (giving: Giving) => number,
  nameWidth?: number,
): ProbeResult => {
  const result: ProbeResult = { states: [], readings: [] };

  render(
    <Probe
      boxWidth={boxWidth}
      widthFor={widthFor}
      nameWidth={nameWidth}
      values={VALUES}
      readings={result.readings}
      onState={(state: TableScrollState) => {
        result.states.push(state);
      }}
    />,
  );

  return result;
};

const lastState: (result: ProbeResult) => TableScrollState | undefined = (
  result: ProbeResult,
): TableScrollState | undefined => {
  return result.states[result.states.length - 1];
};

const giveOf: (index: number) => string | null = (
  index: number,
): string | null => {
  return screen
    .getByTestId(`value-${index}`)
    .getAttribute(TABLE_VALUE_GIVE_ATTRIBUTE);
};

const wrapOf: () => string | null = (): string | null => {
  return screen.getByTestId("table").getAttribute(TABLE_HEADER_WRAP_ATTRIBUTE);
};

/*
 * The widths of a table 940px wide whose card is 938px wide: 40px over with
 * its names at their cap, 20px over with them given way, 2px over with its
 * header's names wrapping too, and 60px to spare with its values cut short.
 */
const TIGHT: (giving: Giving) => number = (giving: Giving): number => {
  if (giving.give) {
    return 878;
  }
  if (giving.wrap) {
    return 940;
  }
  if (giving.fill) {
    return 958;
  }
  return 978;
};

describe("useTableScrollState gives way before the rows scroll", () => {
  test("a table that fits with its names set free gives no more way", () => {
    const result: ProbeResult = renderProbe(938, (giving: Giving) => {
      return giving.fill ? 900 : 1100;
    });

    expect(wrapOf()).toBeNull();
    expect(giveOf(0)).toBeNull();
    expect(giveOf(2)).toBeNull();
    expect(result.readings).toEqual([{ fill: true, wrap: false, give: false }]);
    expect(lastState(result)).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("a table that fits once its header's names wrap: they wrap, and nothing is cut short", () => {
    const result: ProbeResult = renderProbe(938, (giving: Giving) => {
      return giving.wrap ? 930 : 960;
    });

    expect(wrapOf()).toBe("true");
    expect(
      VALUES.map((_value: unknown, index: number): string | null => {
        return giveOf(index);
      }),
    ).toEqual([null, null, null, null]);
    expect(screen.getByTestId("name")).toHaveAttribute(
      TABLE_FILL_ATTRIBUTE,
      "true",
    );
    expect(lastState(result)).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("a table that fits once its long values give way: only the long lines and boxes are cut short", () => {
    const result: ProbeResult = renderProbe(938, TIGHT);

    expect(wrapOf()).toBe("true");
    expect(
      VALUES.map((_value: unknown, index: number): string | null => {
        return giveOf(index);
      }),
    ).toEqual(["line", null, "box", null]);
    expect(lastState(result)).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
    expect(result.readings).toEqual([
      { fill: true, wrap: false, give: false },
      { fill: true, wrap: true, give: false },
      { fill: true, wrap: true, give: true },
    ]);
  });

  test("the readings, in the order they are tried", () => {
    expect(TABLE_GIVE_WAY_READINGS).toEqual([
      { fill: true, wrap: false, give: false },
      { fill: true, wrap: true, give: false },
      { fill: true, wrap: true, give: true },
      { fill: false, wrap: false, give: false },
    ]);
  });

  /*
   * Giving way is only ever how a table comes to fit. A table that scrolls
   * anyway has the scroll's room to show everything in: its header's names
   * stay on one line ("Incident Number" over two lines was what the table
   * redesign took out), and every value is whole.
   */
  test("a table too wide even so scrolls as it did: names at their cap, its header on one line, every value whole", () => {
    const result: ProbeResult = renderProbe(938, (giving: Giving) => {
      return giving.give ? 1300 : 1500;
    });

    expect(wrapOf()).toBeNull();
    expect(
      VALUES.map((_value: unknown, index: number): string | null => {
        return giveOf(index);
      }),
    ).toEqual([null, null, null, null]);
    expect(screen.getByTestId("name")).toHaveAttribute(
      TABLE_FILL_ATTRIBUTE,
      "false",
    );
    expect(lastState(result)).toEqual({
      isOverflowing: true,
      canStickHeader: false,
    });
    expect(result.readings).toEqual([
      { fill: true, wrap: false, give: false },
      { fill: true, wrap: true, give: false },
      { fill: true, wrap: true, give: true },
      { fill: false, wrap: false, give: false },
    ]);
  });

  test("a table of short names, which the fill's floor only widens, fits with nothing given way, as it always did", () => {
    const result: ProbeResult = renderProbe(
      938,
      (giving: Giving) => {
        if (giving.fill) {
          return 1000;
        }
        return giving.give ? 820 : 930;
      },
      // "Checkout API": narrower than the 10rem a name set free gives to.
      120,
    );

    expect(wrapOf()).toBeNull();
    expect(giveOf(0)).toBeNull();
    expect(screen.getByTestId("name")).toHaveAttribute(
      TABLE_FILL_ATTRIBUTE,
      "false",
    );
    expect(lastState(result)).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
    // Read once, as it is drawn: there was nothing to set free.
    expect(result.readings).toEqual([
      { fill: false, wrap: false, give: false },
    ]);
  });

  /*
   * The postmortem rules in German ran 20px past their card while "Checkout
   * API" stood in a 10rem column: the fill's floor widened short names in
   * every reading that gives way. A name no wider than the floor is never
   * set free now, so the header's names and the long values give way
   * beside it at its own width.
   */
  test("a table of short names gives way as any other, its names at their own width", () => {
    const result: ProbeResult = renderProbe(
      938,
      (giving: Giving) => {
        // As the browser would: a short name set free stands 10rem wide.
        const widened: number = giving.fill ? 40 : 0;

        if (giving.give) {
          return 930 + widened;
        }
        return (giving.wrap ? 950 : 990) + widened;
      },
      120,
    );

    expect(screen.getByTestId("name")).toHaveAttribute(
      TABLE_FILL_ATTRIBUTE,
      "false",
    );
    expect(wrapOf()).toBe("true");
    expect(giveOf(0)).toBe("line");
    expect(giveOf(2)).toBe("box");
    expect(result.readings).toEqual([
      { fill: false, wrap: false, give: false },
      { fill: false, wrap: true, give: false },
      { fill: false, wrap: true, give: true },
    ]);
    expect(lastState(result)).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("every reading starts with nothing given but the names, so the states never chase each other", () => {
    const result: ProbeResult = renderProbe(938, TIGHT);

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    // Three readings a measurement, each starting from the first.
    expect(result.readings).toHaveLength(9);
    for (let index: number = 0; index < 9; index += 3) {
      expect(result.readings[index]).toEqual({
        fill: true,
        wrap: false,
        give: false,
      });
    }
    expect(giveOf(0)).toBe("line");
    expect(wrapOf()).toBe("true");
    expect(lastState(result)).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("a card made wider gives the room back: nothing stays cut short", () => {
    let boxWidth: number = 938;
    const result: ProbeResult = { states: [], readings: [] };

    const draw: () => ReactElement = (): ReactElement => {
      return (
        <Probe
          boxWidth={boxWidth}
          widthFor={TIGHT}
          values={VALUES}
          readings={result.readings}
          onState={(state: TableScrollState) => {
            result.states.push(state);
          }}
        />
      );
    };

    const { rerender } = render(draw());

    expect(giveOf(0)).toBe("line");

    boxWidth = 1200;
    rerender(draw());

    expect(wrapOf()).toBeNull();
    expect(giveOf(0)).toBeNull();
    expect(giveOf(2)).toBeNull();
    expect(lastState(result)).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });
});

interface Row extends GenericObject {
  name: string;
  host: string;
  createdAt: string;
  count: number;
  isOn: boolean;
}

const ROWS: Array<Row> = [
  {
    name: "Checkout API",
    host: "web-prod-03.eu-west-1.internal",
    createdAt: "2026-10-20T09:00:00.000Z",
    count: 12,
    isOn: true,
  },
];

const COLUMNS: Columns<Row> = [
  { title: "Name", key: "name", type: FieldType.Text },
  { title: "Host", key: "host", type: FieldType.Text },
  { title: "Created", key: "createdAt", type: FieldType.DateTime },
  { title: "Count", key: "count", type: FieldType.Number },
  { title: "On", key: "isOn", type: FieldType.Boolean },
  { title: "Notes", key: "host", type: FieldType.Text, wrapContent: true },
  { title: "Actions", type: FieldType.Actions },
];

describe("a drawn table", () => {
  const renderTable: () => void = (): void => {
    render(
      <Table<Row>
        id="give"
        data={ROWS}
        columns={COLUMNS}
        singularLabel="Host"
        pluralLabel="Hosts"
        currentPageNumber={1}
        totalItemsCount={1}
        itemsOnPage={10}
        error=""
        isLoading={false}
        onNavigateToPage={(): void => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={(): void => {}}
        actionButtons={[
          {
            title: "View",
            icon: IconProp.Eye,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: (): void => {},
          },
        ]}
      />,
    );
  };

  test("marks the values that may be cut short: not the name, the date, the count, the tick, the prose or the actions", () => {
    renderTable();

    const row: HTMLElement = screen.getAllByRole("row")[1] as HTMLElement;
    const cells: Array<HTMLElement> = Array.from(
      row.querySelectorAll("td"),
    ) as Array<HTMLElement>;

    expect(
      cells.map((cell: HTMLElement): boolean => {
        return Boolean(cell.querySelector(`[${TABLE_VALUE_ATTRIBUTE}]`));
      }),
    ).toEqual([false, true, false, false, false, false, false]);

    // The name is the row's own to fill.
    expect(cells[0]!.querySelector(`[${TABLE_NAME_ATTRIBUTE}]`)).not.toBeNull();
  });

  test("every header's name can wrap, once the table says so", () => {
    renderTable();

    /*
     * What each header cell draws its name in - not the edge a person drags
     * to size its column (ColumnResize), drawn over the cell's end.
     */
    const headers: Array<HTMLElement> = Array.from(
      document.querySelectorAll(
        "thead th button, thead th > div:not([data-column-resize-handle])",
      ),
    ) as Array<HTMLElement>;

    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.className).toContain(TABLE_HEADER_CONTENT_WRAP_CLASS_NAME);
    }
  });
});

describe("what says its words end in '...' of their own", () => {
  test("a pill does, unless it wraps", () => {
    render(
      <>
        <Pill
          text="SEV-1 Customer Impact"
          color={Color.fromString("#dc2626")}
        />
        <Pill
          text="A label that wraps"
          color={Color.fromString("#4f46e5")}
          isWrapping={true}
        />
      </>,
    );

    const pills: Array<HTMLElement> = screen.getAllByTestId("pill");

    expect(pills[0]).toHaveAttribute(TABLE_SHRINKABLE_ATTRIBUTE, "true");
    expect(pills[1]).not.toHaveAttribute(TABLE_SHRINKABLE_ATTRIBUTE);
  });

  const LIST: ReactElement = (
    <TableColumnListComponent<{ name: string }>
      items={[{ name: "Checkout API" }, { name: "Edge" }]}
      moreTemplate={{ one: "{{count}} more", other: "{{count}} more" }}
      noItemsMessage="None."
      dataTestId="list"
      getEachElement={(item: { name: string }): ReactElement => {
        return <span>{item.name}</span>;
      }}
    />
  );

  test("a list in a table's cell does; in a phone's card or outside a table it does not", () => {
    render(
      <TableCellContext.Provider value={true}>
        {LIST}
      </TableCellContext.Provider>,
    );
    expect(screen.getByTestId("list")).toHaveAttribute(
      TABLE_SHRINKABLE_ATTRIBUTE,
      "true",
    );
    cleanup();

    render(
      <TableCellContext.Provider value={true}>
        <TableCardContext.Provider value={true}>
          {LIST}
        </TableCardContext.Provider>
      </TableCellContext.Provider>,
    );
    expect(screen.getByTestId("list")).not.toHaveAttribute(
      TABLE_SHRINKABLE_ATTRIBUTE,
    );
    cleanup();

    render(LIST);
    expect(screen.getByTestId("list")).not.toHaveAttribute(
      TABLE_SHRINKABLE_ATTRIBUTE,
    );
  });
});
