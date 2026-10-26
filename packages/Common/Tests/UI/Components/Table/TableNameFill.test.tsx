import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement, useRef } from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  TABLE_CELL_MAX_WIDTH_CLASS_NAME,
  TABLE_NAME_FILL_FLOOR_IN_PX,
  TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME,
  TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import useTableScrollState, {
  TABLE_FILL_ATTRIBUTE,
  TABLE_NAME_ATTRIBUTE,
  TableScrollState,
  getNamesWiderThanFloor,
  isLineOfText,
} from "../../../../UI/Components/Table/useTableScrollState";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../../Types/Icon/IconProp";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";

/*
 * A row's name uses the room a table that fits has (model-table-ui): the
 * first column's value lifts its 20rem cap while the table fits its card,
 * so a long name is cut short where its column ends - after its first line,
 * with an ellipsis - not at 20rem with half the row empty. It gives way down
 * to 10rem before the table scrolls; a table too wide even so scrolls, and
 * its names keep their cap. Only a name drawn as a line of text is set
 * free: a person's picture beside a name over an email would wrap inside
 * itself, and its row grow. Nor is a name no wider than the 10rem floor:
 * it has nothing to give, and the floor would only widen its column.
 *
 * jsdom lays nothing out, so the widths are handed to the elements here and
 * the classes and attributes are what is asserted; what they draw is
 * measured in Chromium by the ModelTables offline suite
 * (packages/E2E/ModelTables, "a row's name uses the room its row has").
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

const FILL_VARIANT: string = "data-[fill=true]:";

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

describe("the classes a row's name fills with", () => {
  test("every one applies only while the name carries data-fill=true", () => {
    for (const token of tokens(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME)) {
      expect([token, token.startsWith(FILL_VARIANT)]).toEqual([token, true]);
    }
  });

  test("the cap lifted, a line that may break anywhere for the measuring, and only its first line shown, to the column's end", () => {
    /*
     * Between any two letters (break-all), not only between words: a
     * name's first line runs to its column's end and its "..." comes where
     * the room does. Breaking between words only ended "Customer-Facing
     * Checkout API" as "Customer-Facing..." with room for twice the words.
     */
    expect(
      tokens(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME).map((token: string) => {
        return token.slice(FILL_VARIANT.length);
      }),
    ).toEqual([
      "max-w-none",
      "min-w-[10rem]",
      "whitespace-normal",
      "break-all",
      "line-clamp-1",
    ]);
  });

  test("its floor is the one a name has to be wider than to be set free", () => {
    expect(TABLE_NAME_FILL_FLOOR_IN_PX).toBe(10 * 16);
    expect(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME).toContain(
      `${FILL_VARIANT}min-w-[10rem]`,
    );
  });

  test("it never narrows below the floor a column of prose has, nor lifts a cap it does not override", () => {
    expect(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME).toContain(
      `${FILL_VARIANT}${TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME}`,
    );
    // The cap it lifts is the table's own 20rem one.
    expect(TABLE_CELL_MAX_WIDTH_CLASS_NAME).toBe("max-w-[20rem]");
    expect(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME).toContain(
      `${FILL_VARIANT}max-w-none`,
    );
  });

  test("the cell itself is left alone: no width that would take every other column's room", () => {
    for (const token of tokens(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME)) {
      const utility: string = token.slice(FILL_VARIANT.length);

      expect([
        token,
        ["w-full", "max-w-0", "table-fixed"].includes(utility),
      ]).toEqual([token, false]);
    }
  });
});

describe("isLineOfText", () => {
  type ValueFunction = (markup: string) => HTMLElement;

  const value: ValueFunction = (markup: string): HTMLElement => {
    const element: HTMLDivElement = document.createElement("div");
    element.innerHTML = markup;
    document.body.appendChild(element);
    return element;
  };

  const LINES: Array<[string, string]> = [
    ["plain words", "Checkout API"],
    [
      "a record's link (AppLink around its name)",
      '<a href="/x" class="hover:underline"><span>Acme Status</span></a>',
    ],
    [
      // Icon draws its svg in a div, which a cell lays out as an inline-block.
      "a monitor's link with its icon, a box with no words in it",
      '<a href="/x"><span class="flex"><div style="display: inline-block"><svg style="display: block" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"></path></svg></div> Checkout API</span></a>',
    ],
    [
      "a picture in the line (Tailwind draws an img as a block)",
      '<img style="display: block" alt="" src="/a.png"> Ada Lovelace',
    ],
    [
      "a colour's dot before a name",
      '<span style="display: inline-block" class="h-2 w-2 rounded-full"></span> Production',
    ],
    ["words in bold", "<strong>INC-5</strong> <em>urgent</em>"],
    [
      "a part laid out in the line, or not at all",
      '<span style="display: contents">Ada</span><span style="display: none">hidden</span>',
    ],
  ];

  test.each(LINES)("%s is a line of text", (_label: string, markup: string) => {
    expect(isLineOfText(value(markup))).toBe(true);
  });

  const BOXES: Array<[string, string]> = [
    [
      "a person: a picture beside a name over an email",
      '<div class="flex"><div><img alt="" src="/a.png"></div><div><div>Ada Lovelace</div><div>ada@acme.example</div></div></div>',
    ],
    ["a block", "<div>Checkout API</div>"],
    ["a paragraph", "<p>Checkout API</p>"],
    ["a flex row", '<span style="display: flex">Checkout API</span>'],
    [
      "an inline-block with words in it",
      '<span style="display: inline-block">Checkout API</span>',
    ],
    ["a grid", '<span style="display: grid">Checkout API</span>'],
    [
      "words deep inside a box in the line",
      '<a href="/x"><span style="display: inline-flex"><span>Ada</span></span></a>',
    ],
  ];

  test.each(BOXES)(
    "%s is not: it would wrap inside itself",
    (_label: string, markup: string) => {
      expect(isLineOfText(value(markup))).toBe(false);
    },
  );
});

/*
 * A box, and a table whose width depends on whether its names are set free:
 * `fillWidth` while any name carries data-fill="true", `capWidth` while none
 * does - the browser's layout, as far as these tests need it. Every reading
 * of the table's width is recorded with the attributes its names had then.
 */
interface ProbeProps {
  boxWidth: number;
  fillWidth: number;
  capWidth: number;
  names: Array<string>;
  // Each name's width as its words: 240px - wider than the floor - unless given.
  nameWidths?: Array<number> | undefined;
  readings: Array<Array<string | null>>;
  onState: (state: TableScrollState) => void;
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
    watch: [props.boxWidth, props.fillWidth, props.capWidth],
  });

  props.onState(state);

  return (
    <div
      data-testid="box"
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
        ref={(element: HTMLTableElement | null) => {
          tableRef.current = element;
          if (element) {
            element.getBoundingClientRect = (): DOMRect => {
              const fills: Array<string | null> = Array.from(
                element.querySelectorAll(`[${TABLE_NAME_ATTRIBUTE}]`),
              ).map((name: Element): string | null => {
                return name.getAttribute(TABLE_FILL_ATTRIBUTE);
              });

              props.readings.push(fills);

              return rect(
                fills.includes("true") ? props.fillWidth : props.capWidth,
              );
            };
          }
        }}
      >
        <tbody>
          {props.names.map((markup: string, index: number) => {
            return (
              <tr key={index}>
                <td>
                  <div
                    data-testid={`name-${index}`}
                    {...{ [TABLE_NAME_ATTRIBUTE]: "true" }}
                    ref={(element: HTMLDivElement | null) => {
                      if (element) {
                        Object.defineProperty(element, "scrollWidth", {
                          configurable: true,
                          value: props.nameWidths?.[index] ?? 240,
                        });
                      }
                    }}
                    dangerouslySetInnerHTML={{ __html: markup }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ProbeResult {
  states: Array<TableScrollState>;
  readings: Array<Array<string | null>>;
}

type RenderProbeFunction = (
  widths: { boxWidth: number; fillWidth: number; capWidth: number },
  names?: Array<string>,
  nameWidths?: Array<number>,
) => ProbeResult;

const renderProbe: RenderProbeFunction = (
  widths: { boxWidth: number; fillWidth: number; capWidth: number },
  names?: Array<string>,
  nameWidths?: Array<number>,
): ProbeResult => {
  const result: ProbeResult = { states: [], readings: [] };

  render(
    <Probe
      {...widths}
      nameWidths={nameWidths}
      names={names ?? ["Customer-Facing Status Page", "Internal Platform"]}
      readings={result.readings}
      onState={(state: TableScrollState) => {
        result.states.push(state);
      }}
    />,
  );

  return result;
};

const fillOf: (index: number) => string | null = (
  index: number,
): string | null => {
  return screen.getByTestId(`name-${index}`).getAttribute(TABLE_FILL_ATTRIBUTE);
};

describe("useTableScrollState sets a row's name free while the table fits", () => {
  test("a table that fits even with its names at their cap: they use the room", () => {
    const result: ProbeResult = renderProbe({
      boxWidth: 1200,
      fillWidth: 1200,
      capWidth: 1100,
    });

    expect(fillOf(0)).toBe("true");
    expect(fillOf(1)).toBe("true");
    expect(result.states[result.states.length - 1]).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("a table that fits only once its names give way: they do, and nothing scrolls", () => {
    // 1400px with the names at 20rem; 1150px with them down to 10rem.
    const result: ProbeResult = renderProbe({
      boxWidth: 1200,
      fillWidth: 1150,
      capWidth: 1400,
    });

    expect(fillOf(0)).toBe("true");
    expect(fillOf(1)).toBe("true");
    expect(result.states[result.states.length - 1]).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("a table too wide even so: its names keep their cap, and the rows scroll", () => {
    const result: ProbeResult = renderProbe({
      boxWidth: 1200,
      fillWidth: 1500,
      capWidth: 1986,
    });

    expect(fillOf(0)).toBe("false");
    expect(fillOf(1)).toBe("false");
    expect(result.states[result.states.length - 1]).toEqual({
      isOverflowing: true,
      canStickHeader: false,
    });
  });

  test("short names, which the 10rem floor would widen: they keep their cap, and the table that fits so does not scroll", () => {
    const result: ProbeResult = renderProbe({
      boxWidth: 1200,
      fillWidth: 1250,
      capWidth: 1150,
    });

    expect(fillOf(0)).toBe("false");
    expect(result.states[result.states.length - 1]).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("every reading starts with the names set free, whatever they were, so the two states never chase each other", () => {
    const result: ProbeResult = renderProbe({
      boxWidth: 1200,
      fillWidth: 1500,
      capWidth: 1986,
    });

    const drawn: number = result.states.length;

    // Measured again with nothing changed - as a window's resize does.
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    /*
     * Four readings a measurement (TABLE_GIVE_WAY_READINGS): set free first
     * - alone, with the header's names wrapping, with the long values cut
     * short too (TableGiveWay.test.tsx) - then back at the cap.
     */
    const MEASUREMENT: Array<Array<string>> = [
      ["true", "true"],
      ["true", "true"],
      ["true", "true"],
      ["false", "false"],
    ];

    expect(result.readings).toEqual([
      ...MEASUREMENT,
      ...MEASUREMENT,
      ...MEASUREMENT,
    ]);
    expect(fillOf(0)).toBe("false");

    // And the state the measurements give is the same each time.
    for (const state of result.states.slice(drawn - 1)) {
      expect(state).toEqual({ isOverflowing: true, canStickHeader: false });
    }
  });

  test("a table that fits is read once: its names stay free", () => {
    const result: ProbeResult = renderProbe({
      boxWidth: 1200,
      fillWidth: 1000,
      capWidth: 1100,
    });

    expect(result.readings).toEqual([["true", "true"]]);
  });

  test("a name that is not a line of text is never set free, beside one that is", () => {
    renderProbe({ boxWidth: 1200, fillWidth: 1000, capWidth: 1100 }, [
      '<div class="flex"><div>Ada Lovelace</div><div>ada@acme.example</div></div>',
      "<a href='/x'><span>Acme Status</span></a>",
    ]);

    expect(fillOf(0)).toBe("false");
    expect(fillOf(1)).toBe("true");
  });

  test("a name no wider than the 10rem floor is never set free, beside one that is: it has nothing to give", () => {
    renderProbe(
      { boxWidth: 1200, fillWidth: 1000, capWidth: 1100 },
      ["Customer-Facing Status Page", "Internal"],
      [240, TABLE_NAME_FILL_FLOOR_IN_PX],
    );

    expect(fillOf(0)).toBe("true");
    // Exactly the floor: setting it free would give nothing.
    expect(fillOf(1)).toBe("false");
  });

  /*
   * "Checkout API" stood in a 10rem column while the person on call beside
   * it was cut short to "ada@acme-co..." - the floor only widened a column
   * of short names. Not one is set free now: the table is read as it is
   * drawn, once, and fits as it always did.
   */
  test("a table whose names are all short is read as it is drawn: not one is set free", () => {
    const result: ProbeResult = renderProbe(
      { boxWidth: 1200, fillWidth: 1250, capWidth: 1150 },
      ["Checkout API", "Edge LB"],
      [96, 52],
    );

    expect(fillOf(0)).toBe("false");
    expect(fillOf(1)).toBe("false");
    expect(result.readings).toEqual([["false", "false"]]);
    expect(result.states[result.states.length - 1]).toEqual({
      isOverflowing: false,
      canStickHeader: true,
    });
  });

  test("a table with no names to set free is measured as it was", () => {
    const result: ProbeResult = renderProbe(
      { boxWidth: 1200, fillWidth: 1500, capWidth: 1500 },
      [],
    );

    expect(result.states[result.states.length - 1]).toEqual({
      isOverflowing: true,
      canStickHeader: false,
    });
  });
});

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
  note?: string | undefined;
}

const ROWS: Array<Row> = [
  {
    _id: "1",
    name: "Customer-Facing Status Page for EU-West Enterprise Customers",
    note: "What customers see",
  },
  { _id: "2", name: "Internal Platform", note: "For the platform team" },
];

const TEXT_COLUMNS: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Note", type: FieldType.Text, key: "note", wrapContent: true },
];

type RenderTableFunction = (options?: {
  columns?: Columns<Row> | undefined;
  withBulkActions?: boolean | undefined;
}) => void;

const renderTable: RenderTableFunction = (options?: {
  columns?: Columns<Row> | undefined;
  withBulkActions?: boolean | undefined;
}): void => {
  render(
    <Table<Row>
      id="fill-table"
      data={ROWS}
      columns={options?.columns ?? TEXT_COLUMNS}
      currentPageNumber={1}
      totalItemsCount={ROWS.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Status Page"
      pluralLabel="Status Pages"
      sortBy={null}
      sortOrder={SortOrder.Ascending}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
      bulkActions={
        options?.withBulkActions
          ? {
              buttons: [
                {
                  title: "Archive",
                  icon: IconProp.Archive,
                  buttonStyleType: ButtonStyleType.NORMAL,
                  onClick: async (): Promise<void> => {},
                },
              ],
            }
          : undefined
      }
      matchBulkSelectedItemByField="_id"
    />,
  );
};

type BodyRowsFunction = () => Array<HTMLElement>;

const bodyRows: BodyRowsFunction = (): Array<HTMLElement> => {
  return Array.from(
    document.querySelectorAll<HTMLElement>("#fill-table-body > tr"),
  );
};

type NameValuesFunction = () => Array<HTMLElement>;

const nameValues: NameValuesFunction = (): Array<HTMLElement> => {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[${TABLE_NAME_ATTRIBUTE}]`),
  );
};

describe("getNamesWiderThanFloor", () => {
  /*
   * A name in a column a table that fits made wide - its spare room shared
   * out - reports the column's width, not its own: read so, a short name
   * would be set free on one measurement and not the next, and the two
   * would chase each other.
   */
  test("each name is read as wide as its words, whatever its column is now, and left as it was", () => {
    /*
     * jsdom's styles take no max-content, so each name here is a stand-in
     * with a style of its own: as wide as its words while its width is
     * max-content, and as wide as its 300px column otherwise.
     */
    interface StandIn {
      style: { width: string; removeProperty: (name: string) => string };
      scrollWidth: number;
      widthsSeen: Array<string>;
    }

    const standIn: (ownWidth: number) => StandIn = (
      ownWidth: number,
    ): StandIn => {
      const name: StandIn = {
        style: {
          width: "",
          removeProperty: (property: string): string => {
            expect(property).toBe("width");
            name.style.width = "";
            return "";
          },
        },
        widthsSeen: [],
        get scrollWidth(): number {
          name.widthsSeen.push(name.style.width);
          return name.style.width === "max-content" ? ownWidth : 300;
        },
      };

      return name;
    };

    const names: Array<StandIn> = [standIn(120), standIn(240)];

    expect(
      getNamesWiderThanFloor(names as unknown as Array<HTMLElement>),
    ).toEqual([false, true]);

    for (const name of names) {
      // Read once, as wide as its words...
      expect(name.widthsSeen).toEqual(["max-content"]);
      // ...and left as it was.
      expect(name.style.width).toBe("");
    }
  });
});

/*
 * jsdom lays nothing out: here a value is as wide as its words, 8px a
 * letter, so a long name is wider than the 10rem floor and a short one is
 * not.
 */
const giveTextTheirWidths: () => void = (): void => {
  jest
    .spyOn(Element.prototype, "scrollWidth", "get")
    .mockImplementation(function (this: Element): number {
      return (this.textContent || "").length * 8;
    });
};

describe("the table's rows", () => {
  test("the row's name is marked, and a long one uses the room while the table fits; a short one, and no other value, is not set free", () => {
    giveTextTheirWidths();
    renderTable();

    const names: Array<HTMLElement> = nameValues();

    expect(names).toHaveLength(2);

    const [longRow, shortRow] = bodyRows();

    for (const row of [longRow!, shortRow!]) {
      const [name, note] = Array.from(row.children).map((cell: Element) => {
        return cell.firstElementChild as HTMLElement;
      });

      expect(name).toHaveAttribute(TABLE_NAME_ATTRIBUTE, "true");
      expect(name).toHaveClass(
        TABLE_CELL_MAX_WIDTH_CLASS_NAME,
        ...tokens(TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME),
      );

      expect(note).not.toHaveAttribute(TABLE_NAME_ATTRIBUTE);
      expect(note).not.toHaveAttribute(TABLE_FILL_ATTRIBUTE);
    }

    // "Customer-Facing Status Page for EU-West Enterprise Customers"...
    expect(longRow!.firstElementChild!.firstElementChild).toHaveAttribute(
      TABLE_FILL_ATTRIBUTE,
      "true",
    );
    // ...and "Internal Platform", narrower than the floor.
    expect(shortRow!.firstElementChild!.firstElementChild).toHaveAttribute(
      TABLE_FILL_ATTRIBUTE,
      "false",
    );
  });

  test("with a select box first, the name is still the first column of values", () => {
    renderTable({ withBulkActions: true });

    const cells: Array<Element> = Array.from(bodyRows()[0]!.children);

    expect(cells[0]!.querySelector(`[${TABLE_NAME_ATTRIBUTE}]`)).toBeNull();
    expect(cells[1]!.firstElementChild).toHaveAttribute(
      TABLE_NAME_ATTRIBUTE,
      "true",
    );
  });

  test("a table wider than its card keeps its names at their cap", () => {
    const original: () => DOMRect = HTMLElement.prototype.getBoundingClientRect;

    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.tagName === "TABLE") {
          return { width: 1986 } as DOMRect;
        }

        if (this.getAttribute("data-testid") === "table-scroll") {
          return { width: 1214 } as DOMRect;
        }

        return original.call(this);
      });

    renderTable();

    for (const name of nameValues()) {
      expect(name).toHaveAttribute(TABLE_FILL_ATTRIBUTE, "false");
    }

    expect(screen.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "true",
    );
  });

  test("a name drawn as a box of its own - a person - keeps its cap even where it fits", () => {
    renderTable({
      columns: [
        {
          title: "Person",
          type: FieldType.Element,
          key: "name",
          getElement: (item: Row): ReactElement => {
            return (
              <div className="flex">
                <div className="h-8 w-8 rounded-full" />
                <div>
                  <div>{item.name}</div>
                  <div>someone@acme.example</div>
                </div>
              </div>
            );
          },
        },
        { title: "Note", type: FieldType.Text, key: "note" },
      ],
    });

    const names: Array<HTMLElement> = nameValues();

    expect(names).toHaveLength(2);

    for (const name of names) {
      expect(name).toHaveAttribute(TABLE_FILL_ATTRIBUTE, "false");
    }
  });

  test("a name drawn as a link is a line of text: a long one uses the room", () => {
    giveTextTheirWidths();
    renderTable({
      columns: [
        {
          title: "Name",
          type: FieldType.Element,
          key: "name",
          getElement: (item: Row): ReactElement => {
            return (
              <a href={`/status-pages/${item._id}`} className="hover:underline">
                <span>{item.name}</span>
              </a>
            );
          },
        },
        { title: "Note", type: FieldType.Text, key: "note" },
      ],
    });

    expect(
      nameValues().map((name: HTMLElement): string | null => {
        return name.getAttribute(TABLE_FILL_ATTRIBUTE);
      }),
    ).toEqual(["true", "false"]);
  });

  test("a first column of prose, or one a page measured, is not marked", () => {
    renderTable({
      columns: [
        { title: "Note", type: FieldType.Text, key: "note", wrapContent: true },
        { title: "Name", type: FieldType.Text, key: "name" },
      ],
    });

    expect(nameValues()).toHaveLength(0);

    cleanup();

    renderTable({
      columns: [
        {
          title: "Name",
          type: FieldType.Text,
          key: "name",
          contentClassName: "max-w-[10rem]",
        },
        { title: "Note", type: FieldType.Text, key: "note" },
      ],
    });

    expect(nameValues()).toHaveLength(0);
  });

  test("on a phone the rows are cards, with no name to set free", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });

    renderTable();

    expect(nameValues()).toHaveLength(0);
  });
});

describe("a name cut short after its first line", () => {
  type SizeFunction = (
    element: HTMLElement,
    size: {
      scrollWidth: number;
      clientWidth: number;
      scrollHeight: number;
      clientHeight: number;
    },
  ) => void;

  const size: SizeFunction = (
    element: HTMLElement,
    sizes: {
      scrollWidth: number;
      clientWidth: number;
      scrollHeight: number;
      clientHeight: number;
    },
  ): void => {
    for (const [key, amount] of Object.entries(sizes)) {
      Object.defineProperty(element, key, {
        configurable: true,
        value: amount,
      });
    }
  };

  test("shows in full under the pointer: a line the clamp hid is cut short too", () => {
    renderTable();

    const name: HTMLElement = nameValues()[0]!;

    // As wide as its column, two lines tall where one shows.
    size(name, {
      scrollWidth: 300,
      clientWidth: 300,
      scrollHeight: 48,
      clientHeight: 24,
    });
    fireEvent.mouseEnter(name);

    expect(name).toHaveAttribute("title", ROWS[0]!.name!);
  });

  test("a name on its one line gets no tooltip - nor does a pixel of rounding", () => {
    renderTable();

    const name: HTMLElement = nameValues()[1]!;

    size(name, {
      scrollWidth: 120,
      clientWidth: 300,
      scrollHeight: 25,
      clientHeight: 24,
    });
    fireEvent.mouseEnter(name);

    expect(name).not.toHaveAttribute("title");
  });
});
