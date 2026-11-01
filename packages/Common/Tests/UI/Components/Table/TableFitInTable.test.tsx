import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { forgetRememberedTableFits } from "../../../../UI/Components/Table/useTableFit";
import {
  useIsTableColumnDrawn,
  useIsTableColumnFolded,
} from "../../../../UI/Components/Table/TableCellContext";
import {
  TABLE_CARDS_HEADER_TEST_ID,
  TABLE_CARDS_SORT_TEST_ID,
} from "../../../../UI/Components/Table/TableCardsHeader";
import { TABLE_FOLDED_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableFoldedValues";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../Types/GenericObject";
import ObjectID from "../../../../Types/ObjectID";
import User from "../../../../UI/Utils/User";
import IconProp from "../../../../Types/Icon/IconProp";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import ActionButtonSchema from "../../../../UI/Components/ActionButton/ActionButtonSchema";

/*
 * A table fits the box it is drawn in, not the window (TableFit):
 *
 *   - a phone draws its rows as cards from the first paint - "on a phone
 *     every Common Table first paints as the desktop table and turns into
 *     cards about 100 ms later";
 *   - a box narrower than 48rem folds its foldable columns, whatever the
 *     window - "Fold columns by the card's own width, not the window's";
 *   - rows that do not fit their box fold, and in a box narrower than 48rem
 *     turn into cards - "Most tables at 768-900px still scroll: more folds
 *     or tablet cards";
 *   - a box made wider tries the roomier way again.
 *
 * jsdom lays nothing out: the box's width and the table's (a column's
 * header at 200px, the select box and the end at 60px) are handed out here
 * as Chromium would draw them; packages/E2E/ModelTables measures the real
 * thing.
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

interface Incident extends GenericObject {
  _id: string;
  title: string;
  state: string;
  severity: string;
  owner: string;
}

const INCIDENTS: Array<Incident> = [
  {
    _id: "1",
    title: "Checkout API returns 502",
    state: "Investigating",
    severity: "Critical",
    owner: "Ada Lovelace",
  },
  {
    _id: "2",
    title: "Login page slow",
    state: "Identified",
    severity: "Minor",
    owner: "Grace Hopper",
  },
];

// A cell that says whether the Owner column is drawn, and folded.
function TitleCell(props: { incident: Incident }): ReactElement {
  const isOwnerDrawn: boolean = useIsTableColumnDrawn("owner");
  const isOwnerFolded: boolean = useIsTableColumnFolded("owner");

  return (
    <span
      data-testid={`title-${props.incident._id}`}
      data-owner-drawn={isOwnerDrawn ? "true" : "false"}
      data-owner-folded={isOwnerFolded ? "true" : "false"}
    >
      {props.incident.title}
    </span>
  );
}

const COLUMNS: Columns<Incident> = [
  {
    key: "title",
    title: "Title",
    type: FieldType.Element,
    getElement: (incident: Incident): ReactElement => {
      return <TitleCell incident={incident} />;
    },
  },
  { key: "state", title: "State", type: FieldType.Text },
  {
    key: "severity",
    title: "Severity",
    type: FieldType.Text,
    hideBelowLargeScreen: true,
    foldInto: "state",
  },
  {
    id: "owner",
    key: "owner",
    title: "Owner",
    type: FieldType.Text,
    disableSort: true,
  },
];

const COLUMNS_THAT_DO_NOT_FOLD: Columns<Incident> = COLUMNS.map(
  (column: Columns<Incident>[number]) => {
    return { ...column, hideBelowLargeScreen: false, foldInto: undefined };
  },
);

let boxWidth: number = 938;
// Each header cell's width: what the rows need, column by column.
let columnWidth: number = 200;

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

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

beforeEach(() => {
  boxWidth = 938;
  columnWidth = 200;
  setWindowWidth(1280);

  jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element): DOMRect {
      if (this.getAttribute("data-testid") === "table-scroll") {
        return rect(boxWidth);
      }

      if (this.tagName === "TABLE") {
        const headerCells: number = this.querySelectorAll("thead th").length;

        return rect(headerCells * columnWidth);
      }

      return rect(0);
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  forgetRememberedTableFits();
  setWindowWidth(1024);
});

interface DrawProps {
  columns?: Columns<Incident> | undefined;
  onSortChanged?:
    | ((sortBy: keyof Incident | null, order: SortOrder) => void)
    | undefined;
  sortBy?: keyof Incident | null | undefined;
}

const TableUnderTest: (props: DrawProps) => ReactElement = (
  props: DrawProps,
): ReactElement => {
  return (
    <Table<Incident>
      id="incidents"
      data={INCIDENTS}
      columns={props.columns || COLUMNS}
      singularLabel="Incident"
      pluralLabel="Incidents"
      currentPageNumber={1}
      totalItemsCount={INCIDENTS.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      onNavigateToPage={(): void => {}}
      sortOrder={SortOrder.Descending}
      sortBy={props.sortBy === undefined ? "state" : props.sortBy}
      onSortChanged={props.onSortChanged || ((): void => {})}
    />
  );
};

const draw: (props?: DrawProps) => void = (props?: DrawProps): void => {
  render(<TableUnderTest {...(props || {})} />);
};

const headerTitles: () => Array<string> = (): Array<string> => {
  return Array.from(document.querySelectorAll("thead th")).map(
    (cell: Element): string => {
      return (cell.textContent || "").trim();
    },
  );
};

const resizeWindow: (width: number) => Promise<void> = async (
  width: number,
): Promise<void> => {
  setWindowWidth(width);

  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await Promise.resolve();
  });
};

describe("a phone", () => {
  test("its first paint is already the cards: no table is ever drawn", () => {
    setWindowWidth(390);

    // What React draws before any effect has run.
    const firstPaint: string = renderToString(<TableUnderTest />);

    expect(firstPaint).not.toContain("<table");
    expect(firstPaint).toContain("Checkout API returns 502");
  });

  test("and drawn for real, the cards come with the band that selects and sorts them", () => {
    setWindowWidth(390);
    boxWidth = 342;

    draw();

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID)).toBeInTheDocument();
    // A phone's card shows nothing of what a phone leaves out: here, nothing.
    expect(screen.getByText("Checkout API returns 502")).toBeInTheDocument();
  });

  test("a wide window's first paint is the table's rows", () => {
    setWindowWidth(1280);

    expect(renderToString(<TableUnderTest />)).toContain("<table");
  });
});

describe("a box narrower than 48rem", () => {
  test("folds its foldable columns, though the window is wide and the rows would fit", () => {
    boxWidth = 700;
    columnWidth = 100;

    draw();

    expect(headerTitles()).toEqual(["Title", "State", "Owner"]);
    // The severity is under the state, on a line of its own.
    const folded: Array<HTMLElement> = screen.getAllByTestId(
      TABLE_FOLDED_VALUE_TEST_ID,
    );

    expect(
      folded.map((line: HTMLElement): string | null => {
        return line.textContent;
      }),
    ).toEqual(["SeverityCritical", "SeverityMinor"]);
  });

  test("draws as cards rows that still do not fit, folded", () => {
    boxWidth = 610;
    // Folded, three columns of 300px: 900px in a 610px box.
    columnWidth = 300;

    draw();

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID)).toBeInTheDocument();
    // As cards, the severity is a field of the card again.
    expect(screen.getAllByText("Severity").length).toBeGreaterThan(0);
    expect(screen.queryByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toBeNull();
  });

  test("keeps the rows of a table only 2rem too wide: they scroll the last few pixels", () => {
    boxWidth = 610;
    // Folded, three columns: 630px, 20px over.
    columnWidth = 210;

    draw();

    expect(document.querySelector("table")).not.toBeNull();
    expect(screen.queryByTestId(TABLE_CARDS_HEADER_TEST_ID)).toBeNull();
  });

  test("with nothing to fold, goes from rows straight to cards", () => {
    boxWidth = 610;
    columnWidth = 200;

    draw({ columns: COLUMNS_THAT_DO_NOT_FOLD });

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID)).toBeInTheDocument();
  });
});

describe("a box 48rem or wider", () => {
  test("draws every column while the rows fit", () => {
    boxWidth = 938;
    columnWidth = 200;

    draw();

    expect(headerTitles()).toEqual(["Title", "State", "Severity", "Owner"]);
    expect(screen.queryByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toBeNull();
  });

  test("folds rows that do not fit it - and never draws cards", () => {
    boxWidth = 938;
    // Four columns of 300px are 1200px; folded, three are 900px.
    columnWidth = 300;

    draw();

    expect(headerTitles()).toEqual(["Title", "State", "Owner"]);
    expect(screen.getAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toHaveLength(2);
  });

  test("rows that fit neither way scroll, as they always did", () => {
    boxWidth = 938;
    columnWidth = 600;

    draw({ columns: COLUMNS_THAT_DO_NOT_FOLD });

    expect(document.querySelector("table")).not.toBeNull();
    expect(screen.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "true",
    );
  });
});

/*
 * A person's sizing stands: a column they made wider is the width they
 * asked for, and the rows scroll for it, as they did before a table could
 * fold - Affected Resources made wider folded Severity, Duration, Labels
 * and Owners away under other cells, and the keyboard's focus on its edge
 * went to another column's. A card narrower than 48rem still folds, and
 * draws cards, as any other.
 */
describe("a table whose columns a person sized", () => {
  const PERSON: string = "80000000-0000-4000-8000-000000000001";

  const keepWidths: (widths: Record<string, number>) => void = (
    widths: Record<string, number>,
  ): void => {
    jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
      return new ObjectID(PERSON);
    });
    window.localStorage.setItem(
      `TableColumnWidths.${PERSON}.incidents`,
      JSON.stringify(widths),
    );
  };

  afterEach(() => {
    window.localStorage.clear();
  });

  test("keeps its columns in a card 48rem or wider: the rows scroll", () => {
    keepWidths({ owner: 320 });
    boxWidth = 938;
    // Four columns of 300px are 1200px: folded, they would fit.
    columnWidth = 300;

    draw();

    // Every column (and, with no Actions column, the sized table's end filler).
    expect(
      headerTitles().filter((title: string): boolean => {
        return title !== "";
      }),
    ).toEqual(["Title", "State", "Severity", "Owner"]);
    expect(screen.queryByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toBeNull();
    expect(screen.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "true",
    );
  });

  test("a width kept for a column the table does not draw changes nothing: it folds", () => {
    keepWidths({ elsewhere: 320 });
    boxWidth = 938;
    columnWidth = 300;

    draw();

    expect(headerTitles()).toEqual(["Title", "State", "Owner"]);
  });

  test("in a card narrower than 48rem it folds, and draws cards, as any other", () => {
    keepWidths({ owner: 320 });
    boxWidth = 610;
    columnWidth = 300;

    draw();

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID)).toBeInTheDocument();
  });
});

describe("a row's cell is its column's", () => {
  /*
   * Kept by their place in the row, the cells moved under the keyboard as a
   * table folded: the row's View the keyboard was on became another
   * column's cell, the focus gone - as a live list read a new incident in
   * that no longer fitted, and Enter opened nothing.
   */
  test("the View the keyboard is on keeps the focus as the table folds", async () => {
    boxWidth = 0;
    columnWidth = 0;
    setWindowWidth(1280);

    const view: Array<ActionButtonSchema<Incident>> = [
      {
        title: "View",
        icon: IconProp.Eye,
        buttonStyleType: ButtonStyleType.NORMAL,
        onClick: (): void => {},
      },
    ];

    render(
      <Table<Incident>
        id="incidents"
        data={INCIDENTS}
        columns={[...COLUMNS, { title: "Actions", type: FieldType.Actions }]}
        actionButtons={view}
        singularLabel="Incident"
        pluralLabel="Incidents"
        currentPageNumber={1}
        totalItemsCount={INCIDENTS.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        onNavigateToPage={(): void => {}}
        sortOrder={SortOrder.Descending}
        sortBy="state"
        onSortChanged={(): void => {}}
      />,
    );

    const button: HTMLElement = within(
      document.querySelectorAll<HTMLElement>("#incidents-body > tr")[1]!,
    ).getByRole("button", { name: /View/ });

    act(() => {
      button.focus();
    });
    expect(document.activeElement).toBe(button);

    // Below lg the window stands in for the box: narrow, the table folds.
    await resizeWindow(900);

    expect(
      headerTitles().filter((title: string): boolean => {
        return title !== "Actions";
      }),
    ).toEqual(["Title", "State", "Owner"]);
    expect(document.activeElement).toBe(button);
    expect(button.isConnected).toBe(true);
  });
});

describe("a header cell is its column's", () => {
  test("a table that folds keeps each column's header cell - and what has the focus in it - with its column", async () => {
    boxWidth = 0;
    columnWidth = 0;
    setWindowWidth(1280);

    draw();

    const ownerHeader: Element | null = document.querySelector(
      'thead th[data-column-id="owner"]',
    );

    expect(ownerHeader).not.toBeNull();

    // Below lg the window stands in for the box: narrow, the table folds.
    await resizeWindow(900);

    expect(headerTitles()).toEqual(["Title", "State", "Owner"]);
    expect(document.querySelector('thead th[data-column-id="owner"]')).toBe(
      ownerHeader,
    );
  });
});

describe("a box that changes size", () => {
  test("cards in a narrow box go back to rows when the window - standing in for the box - is wide again", async () => {
    // No layout: the window says how wide the box is.
    boxWidth = 0;
    setWindowWidth(900);
    columnWidth = 0;

    draw({ columns: COLUMNS_THAT_DO_NOT_FOLD });

    // Not measured, below lg: narrow - but the rows (0px) fit: rows.
    expect(document.querySelector("table")).not.toBeNull();

    await resizeWindow(390);
    expect(document.querySelector("table")).toBeNull();

    await resizeWindow(1280);
    expect(document.querySelector("table")).not.toBeNull();
  });
});

describe("a table opened again", () => {
  test("starts as it was left: a list that turned into cards loads as cards", () => {
    boxWidth = 610;
    columnWidth = 200;

    draw({ columns: COLUMNS_THAT_DO_NOT_FOLD });
    expect(document.querySelector("table")).toBeNull();

    cleanup();

    // Opened again, its first page still loading: the cards' placeholders.
    render(
      <Table<Incident>
        id="incidents"
        data={[]}
        columns={COLUMNS_THAT_DO_NOT_FOLD}
        singularLabel="Incident"
        pluralLabel="Incidents"
        currentPageNumber={1}
        totalItemsCount={0}
        itemsOnPage={10}
        error=""
        isLoading={true}
        onNavigateToPage={(): void => {}}
        sortOrder={SortOrder.Descending}
        sortBy={null}
        onSortChanged={(): void => {}}
      />,
    );

    const skeleton: HTMLElement = screen.getByTestId("table-skeleton-loader");

    expect(skeleton.tagName).toBe("DIV");
    expect(document.querySelector("table")).toBeNull();
  });

  test("other columns are measured afresh", () => {
    boxWidth = 610;
    columnWidth = 200;

    draw({ columns: COLUMNS_THAT_DO_NOT_FOLD });
    expect(document.querySelector("table")).toBeNull();

    cleanup();

    // Two narrow columns fit the box: rows.
    columnWidth = 150;
    draw({ columns: COLUMNS_THAT_DO_NOT_FOLD.slice(0, 2) });
    expect(document.querySelector("table")).not.toBeNull();
  });
});

describe("what a cell may ask of its table", () => {
  test("a column drawn as a column of its own", () => {
    draw();

    expect(screen.getByTestId("title-1")).toHaveAttribute(
      "data-owner-drawn",
      "true",
    );
    expect(screen.getByTestId("title-1")).toHaveAttribute(
      "data-owner-folded",
      "false",
    );
  });

  test("a column the table folds into another's cell", () => {
    boxWidth = 700;
    columnWidth = 100;

    draw({
      columns: COLUMNS.map((column: Columns<Incident>[number]) => {
        return column.key === "owner"
          ? { ...column, hideBelowLargeScreen: true, foldInto: "title" }
          : column;
      }),
    });

    expect(screen.getByTestId("title-1")).toHaveAttribute(
      "data-owner-drawn",
      "false",
    );
    expect(screen.getByTestId("title-1")).toHaveAttribute(
      "data-owner-folded",
      "true",
    );
  });

  test("outside a table, neither", () => {
    render(<TitleCell incident={INCIDENTS[0]!} />);

    expect(screen.getByTestId("title-1")).toHaveAttribute(
      "data-owner-drawn",
      "false",
    );
    expect(screen.getByTestId("title-1")).toHaveAttribute(
      "data-owner-folded",
      "false",
    );
  });
});

describe("cards are sorted from their band", () => {
  test("the band says how the list is sorted, and offers the columns that sort", async () => {
    setWindowWidth(390);
    boxWidth = 342;
    const sorts: Array<[keyof Incident | null, SortOrder]> = [];

    draw({
      onSortChanged: (sortBy: keyof Incident | null, order: SortOrder) => {
        sorts.push([sortBy, order]);
      },
    });

    const band: HTMLElement = screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID);
    const sort: HTMLElement = within(band).getByTestId(
      TABLE_CARDS_SORT_TEST_ID,
    );

    expect(sort).toHaveTextContent("Sorted by State");

    await act(async () => {
      sort.click();
      await Promise.resolve();
    });

    // Owner does not sort: it is not offered.
    expect(
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-title`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${TABLE_CARDS_SORT_TEST_ID}-owner`),
    ).toBeNull();

    await act(async () => {
      screen.getByTestId(`${TABLE_CARDS_SORT_TEST_ID}-title`).click();
      await Promise.resolve();
    });

    expect(sorts).toEqual([["title", SortOrder.Descending]]);
  });
});
