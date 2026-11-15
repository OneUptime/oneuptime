import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import TableBody from "../../../../UI/Components/Table/TableBody";
import TableEmptyValue, {
  TABLE_EMPTY_VALUE_CLASS_NAME,
  TABLE_EMPTY_VALUE_SMALL_CLASS_NAME,
  TABLE_EMPTY_VALUE_TEST_ID,
  isEmptyValueElement,
} from "../../../../UI/Components/Table/TableEmptyValue";
import { isEmptyFoldedContent } from "../../../../UI/Components/Table/TableFoldedValues";
import EmptyValue, {
  EMPTY_VALUE_CLASS_NAME,
  EMPTY_VALUE_SMALL_CLASS_NAME,
  EMPTY_VALUE_TEST_ID,
  isDashText,
} from "../../../../UI/Components/Detail/EmptyValue";
import Column from "../../../../UI/Components/Table/Types/Column";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * THE QUIET DASH A PAGE DRAWS INSIDE AN ELEMENT OF ITS OWN (#7603, #8209).
 *
 * Some six hundred cells drew a dash of their own for a value that is not
 * there - `{team.name || "-"}`, `<span className="text-gray-400">—</span>`
 * - and now draw the quiet dash in its place, often still inside the
 * page's element: `<p>{team.name || <TableEmptyValue />}</p>`. A phone's
 * card leaves out a field that has nothing to say, and knew the quiet dash
 * only as the cell's whole element, so it drew "Team: —" where it leaves
 * every other empty field out. isEmptyValueElement reads through the
 * page's plain elements to the dash.
 */

afterEach(() => {
  cleanup();
});

interface Row {
  _id: string;
  name: string;
  team?: string | undefined;
}

const NAME_COLUMN: Column<Row> = {
  title: "Name",
  key: "name",
  type: FieldType.Text,
};

// The Admin Dashboard's project members' Team, as it is drawn now.
const TEAM_COLUMN: Column<Row> = {
  title: "Team",
  key: "team",
  type: FieldType.Element,
  getElement: (row: Row): ReactElement => {
    return <p>{row.team || <TableEmptyValue />}</p>;
  },
};

function row(index: number, team?: string | undefined): Row {
  return {
    _id: `76030000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `Member ${index}`,
    team: team,
  };
}

function renderBody(
  rows: Array<Row>,
  columns: Array<Column<Row>>,
  isMobile: boolean,
): void {
  const body: ReactElement = (
    <TableBody<Row>
      id="members-body"
      data={rows}
      columns={columns}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={isMobile}
      isPhone={isMobile}
    />
  );

  render(isMobile ? body : <table>{body}</table>);
}

// The field names a phone's cards draw, in order.
function fieldNames(): Array<string> {
  return Array.from(document.querySelectorAll("dt")).map(
    (dt: Element): string => {
      return dt.textContent || "";
    },
  );
}

// The marks drawn outside the quiet dash: a hyphen of a cell's own.
function ownDashes(): Array<string> {
  const clone: HTMLElement = document.body.cloneNode(true) as HTMLElement;

  for (const quiet of Array.from(
    clone.querySelectorAll(
      `[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"], [data-testid="${EMPTY_VALUE_TEST_ID}"]`,
    ),
  )) {
    quiet.remove();
  }

  return Array.from(clone.querySelectorAll("*"))
    .filter((node: Element): boolean => {
      return node.children.length === 0 && isDashText(node.textContent || "");
    })
    .map((node: Element): string => {
      return node.textContent || "";
    });
}

describe("isEmptyValueElement", () => {
  test("the quiet dash itself, at either size", () => {
    expect(isEmptyValueElement(<TableEmptyValue />)).toBe(true);
    expect(isEmptyValueElement(<TableEmptyValue isSmall={true} />)).toBe(true);
    expect(
      isEmptyValueElement(<TableEmptyValue screenReaderText="No owners." />),
    ).toBe(true);
    expect(
      isEmptyValueElement(<TableEmptyValue title="Not polled yet" />),
    ).toBe(true);
  });

  test("a card's dash, but not a card's words", () => {
    expect(isEmptyValueElement(<EmptyValue />)).toBe(true);
    expect(isEmptyValueElement(<EmptyValue isSmall={true} />)).toBe(true);
    expect(isEmptyValueElement(<EmptyValue placeholder="-" />)).toBe(true);
    expect(isEmptyValueElement(<EmptyValue placeholder="  " />)).toBe(true);
    expect(
      isEmptyValueElement(<EmptyValue placeholder="No logo uploaded." />),
    ).toBe(false);
  });

  test.each([
    ["p", <p key="p">{<TableEmptyValue />}</p>],
    ["span", <span key="s">{<TableEmptyValue />}</span>],
    [
      "a styled span",
      <span key="c" className="font-mono text-gray-700">
        {<TableEmptyValue />}
      </span>,
    ],
    ["div", <div key="d">{<EmptyValue />}</div>],
    ["bdi", <bdi key="b">{<TableEmptyValue />}</bdi>],
    ["strong", <strong key="st">{<TableEmptyValue />}</strong>],
    ["code", <code key="co">{<TableEmptyValue />}</code>],
    [
      "a fragment",
      <React.Fragment key="f">{<TableEmptyValue />}</React.Fragment>,
    ],
    [
      "a span with a test id",
      <span key="t" data-testid="host-collector-last-report">
        <TableEmptyValue />
      </span>,
    ],
    [
      "wrappers in wrappers",
      <div key="w">
        <span>
          <p> {<TableEmptyValue />} </p>
        </span>
      </div>,
    ],
  ])(
    "a plain element holding only the quiet dash: %s",
    (_name: string, node: ReactElement) => {
      expect(isEmptyValueElement(node)).toBe(true);
    },
  );

  test.each([
    ["a string", "Not set"],
    ["a bare dash", "-"],
    ["nothing", null],
    ["a number", 0],
    ["words", <span key="w">Members</span>],
    [
      "the dash beside words",
      <span key="b">
        Team: <TableEmptyValue />
      </span>,
    ],
    [
      "two dashes",
      <span key="two">
        <TableEmptyValue />
        <TableEmptyValue />
      </span>,
    ],
    [
      "a link holding the dash",
      <a key="a" href="/team">
        <TableEmptyValue />
      </a>,
    ],
    ["a list item", <li key="li">{<TableEmptyValue />}</li>],
    ["a table cell", <td key="td">{<TableEmptyValue />}</td>],
  ])("not: %s", (_name: string, node: React.ReactNode) => {
    expect(isEmptyValueElement(node)).toBe(false);
  });

  test("a folded line under a cell is left out for a wrapped dash too", () => {
    expect(isEmptyFoldedContent(<p>{<TableEmptyValue />}</p>)).toBe(true);
    expect(isEmptyFoldedContent(<TableEmptyValue />)).toBe(true);
    expect(isEmptyFoldedContent(<p>Platform</p>)).toBe(false);
  });
});

describe("a cell that draws the quiet dash inside its own element", () => {
  test("on a laptop's row: the quiet dash, and no hyphen of the page's own", () => {
    renderBody([row(1), row(2, "Platform")], [NAME_COLUMN, TEAM_COLUMN], false);

    expect(screen.getAllByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toHaveLength(1);
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(ownDashes()).toEqual([]);
  });

  test("on a phone's card: the field is left out, as every other empty field is", () => {
    renderBody([row(1), row(2, "Platform")], [NAME_COLUMN, TEAM_COLUMN], true);

    // The first card has no Team; the second names it.
    expect(
      fieldNames().filter((name: string) => {
        return name === "Team";
      }),
    ).toHaveLength(1);
    expect(screen.queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(ownDashes()).toEqual([]);
  });

  test("the check can fail: the old hand-written hyphen is drawn on the card", () => {
    renderBody(
      [row(1)],
      [
        NAME_COLUMN,
        {
          ...TEAM_COLUMN,
          getElement: (item: Row): ReactElement => {
            return <p className="text-gray-700">{item.team || "-"}</p>;
          },
        },
      ],
      true,
    );

    expect(fieldNames()).toContain("Team");
    expect(ownDashes()).toEqual(["-"]);
  });
});

describe("the quiet dash's sizes and words", () => {
  test("in a line of small text, the dash at that size, on that line's height", () => {
    render(<TableEmptyValue isSmall={true} />);

    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID).className).toBe(
      TABLE_EMPTY_VALUE_SMALL_CLASS_NAME,
    );
    // relative keeps the sr-only words in the dash's box (TableEmptyValue).
    expect(TABLE_EMPTY_VALUE_SMALL_CLASS_NAME.split(" ")).toEqual([
      "relative",
      "text-xs",
      "text-gray-400",
    ]);
    // No line height of its own: a widget's row stays as tall as its neighbours.
    expect(TABLE_EMPTY_VALUE_SMALL_CLASS_NAME).not.toContain("leading-");
    expect(
      screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID).querySelector(".sr-only"),
    ).toHaveTextContent("Not set");
  });

  test("a card's dash, small, says the same to a screen reader", () => {
    render(<EmptyValue isSmall={true} />);

    expect(screen.getByTestId(EMPTY_VALUE_TEST_ID).className).toBe(
      EMPTY_VALUE_SMALL_CLASS_NAME,
    );
    expect(EMPTY_VALUE_SMALL_CLASS_NAME).toBe(
      TABLE_EMPTY_VALUE_SMALL_CLASS_NAME,
    );
    expect(
      screen.getByTestId(EMPTY_VALUE_TEST_ID).querySelector(".sr-only"),
    ).toHaveTextContent("Not set");
  });

  test("the row's size is the default, for both", () => {
    render(
      <>
        <TableEmptyValue />
        <EmptyValue />
      </>,
    );

    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID).className).toBe(
      TABLE_EMPTY_VALUE_CLASS_NAME,
    );
    expect(screen.getByTestId(EMPTY_VALUE_TEST_ID).className).toBe(
      EMPTY_VALUE_CLASS_NAME,
    );
  });

  test("says why there is no value under the pointer, when the cell knows", () => {
    render(
      <TableEmptyValue title="Interfaces are collected by the first successful SNMP walk." />,
    );

    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toHaveAttribute(
      "title",
      "Interfaces are collected by the first successful SNMP walk.",
    );
  });

  test("and no title otherwise", () => {
    render(<TableEmptyValue />);

    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).not.toHaveAttribute(
      "title",
    );
  });
});
