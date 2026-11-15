import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import TableBody from "../../../../UI/Components/Table/TableBody";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";
import { TABLE_FOLDED_VALUES_TEST_ID } from "../../../../UI/Components/Table/TableFoldedValues";
import Column from "../../../../UI/Components/Table/Types/Column";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import GenericObject from "../../../../Types/GenericObject";

/*
 * A COLUMN THAT DRAWS ITS OWN ELEMENT DRAWS IT, WITH A KEY OR WITHOUT (#7457).
 *
 * A column's key names the field a plain value is read from, and the one a
 * header sorts by. A column with getElement reads the whole row instead,
 * and the shared table drew nothing for it unless it also had a key:
 * TableRow's getColumnContent asked for the key before it looked at the
 * element. Admin Dashboard > Feedback gave its ten columns an id, a title
 * and an element but no key, and both of its tables drew every answer as
 * an empty row under "Showing 1 of 1 answer", while the answers were
 * stored.
 *
 * Now the element is drawn whether the column has a key or not: in a row,
 * in a phone's card, and folded under another column's value. A column
 * with neither an element nor a key still has nothing to draw.
 */

afterEach(() => {
  cleanup();
});

interface Answer extends GenericObject {
  _id: string;
  topic: string;
  score: number | null;
  details: string | null;
  page: string;
}

const ANSWER: Answer = {
  _id: "74570000-0000-4000-8000-000000000001",
  topic: "Know when my website or API is down",
  score: 5,
  details: "Took me two minutes.",
  page: "/dashboard/:projectId/monitors/setup",
};

// Columns as the Feedback page wrote them: an id, a title, an element, no key.
const ABOUT: Column<Answer> = {
  id: "about",
  title: "About",
  type: FieldType.Element,
  disableSort: true,
  getElement: (row: Answer): ReactElement => {
    return <span data-testid="about-cell">{row.topic}</span>;
  },
};

const ANSWER_COLUMN: Column<Answer> = {
  id: "answer",
  title: "Answer",
  type: FieldType.Element,
  disableSort: true,
  getElement: (row: Answer): ReactElement => {
    return <span data-testid="answer-cell">{`${row.score} of 5`}</span>;
  },
};

const DETAILS: Column<Answer> = {
  id: "details",
  title: "What They Wrote",
  type: FieldType.Element,
  disableSort: true,
  wrapContent: true,
  getElement: (row: Answer): ReactElement => {
    return <p data-testid="details-cell">{row.details}</p>;
  },
};

const PAGE: Column<Answer> = {
  id: "page",
  title: "Page",
  type: FieldType.Element,
  disableSort: true,
  getElement: (row: Answer): ReactElement => {
    return <code data-testid="page-cell">{row.page}</code>;
  },
};

const NO_KEY_COLUMNS: Columns<Answer> = [ABOUT, ANSWER_COLUMN, DETAILS, PAGE];

function renderRows(
  columns: Columns<Answer>,
  options?: {
    isMobile?: boolean;
    rows?: Array<Answer>;
    foldedColumns?: Columns<Answer>;
  },
): void {
  const body: ReactElement = (
    <TableBody<Answer>
      id="answers-body"
      data={options?.rows || [ANSWER]}
      columns={columns}
      foldedColumns={options?.foldedColumns}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={Boolean(options?.isMobile)}
    />
  );

  render(options?.isMobile ? body : <table>{body}</table>);
}

function bodyCells(): Array<HTMLElement> {
  return Array.from(document.querySelectorAll("tbody tr td")).filter(
    (cell: Element): boolean => {
      // The cell after the columns that takes the room left (TableLayout).
      return !cell.hasAttribute("data-testid");
    },
  ) as Array<HTMLElement>;
}

describe("an element column with no key, in a row", () => {
  test("draws its element in its cell", () => {
    renderRows([ABOUT]);

    const cell: HTMLElement = screen.getByTestId("about-cell");

    expect(cell).toHaveTextContent("Know when my website or API is down");
    expect(cell.closest("td")).not.toBeNull();
  });

  test("every cell of a row of such columns holds its value, in order", () => {
    renderRows(NO_KEY_COLUMNS);

    expect(
      bodyCells().map((cell: HTMLElement): string => {
        return cell.textContent || "";
      }),
    ).toEqual([
      "Know when my website or API is down",
      "5 of 5",
      "Took me two minutes.",
      "/dashboard/:projectId/monitors/setup",
    ]);
  });

  test("no cell of a row with values is left empty", () => {
    renderRows(NO_KEY_COLUMNS);

    const cells: Array<HTMLElement> = bodyCells();

    expect(cells).toHaveLength(NO_KEY_COLUMNS.length);

    for (const cell of cells) {
      expect(cell.textContent?.trim()).not.toBe("");
    }
  });

  test("each row draws its own values", () => {
    renderRows([ABOUT, ANSWER_COLUMN], {
      rows: [
        ANSWER,
        {
          ...ANSWER,
          _id: "74570000-0000-4000-8000-000000000002",
          topic: "Give feedback",
          score: 2,
        },
      ],
    });

    expect(
      screen.getAllByTestId("about-cell").map((cell: HTMLElement) => {
        return cell.textContent;
      }),
    ).toEqual(["Know when my website or API is down", "Give feedback"]);
    expect(
      screen.getAllByTestId("answer-cell").map((cell: HTMLElement) => {
        return cell.textContent;
      }),
    ).toEqual(["5 of 5", "2 of 5"]);
  });

  test("an element that is only a dash is the quiet dash, as with a key", () => {
    renderRows([
      {
        ...PAGE,
        getElement: (): ReactElement => {
          return <span>-</span>;
        },
      },
    ]);

    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeInTheDocument();
  });

  test("draws the same as the column with a key", () => {
    renderRows([{ ...ABOUT, key: "topic" }]);

    expect(screen.getByTestId("about-cell")).toHaveTextContent(
      "Know when my website or API is down",
    );
  });

  test("the element reads the whole row, not one field", () => {
    renderRows([
      {
        id: "summary",
        title: "Summary",
        type: FieldType.Element,
        getElement: (row: Answer): ReactElement => {
          return (
            <span data-testid="summary-cell">{`${row.topic}: ${row.score}`}</span>
          );
        },
      },
    ]);

    expect(screen.getByTestId("summary-cell")).toHaveTextContent(
      "Know when my website or API is down: 5",
    );
  });
});

describe("a column with neither an element nor a key", () => {
  test("still draws nothing in its cell", () => {
    renderRows([
      ABOUT,
      { id: "nothing", title: "Nothing", type: FieldType.Text },
    ]);

    const cells: Array<HTMLElement> = bodyCells();

    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveTextContent("Know when my website or API is down");
    expect(cells[1]?.textContent).toBe("");
    expect(
      screen.queryByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("an element column with no key, in a phone's card", () => {
  // The field names a card draws, in order.
  function fieldNames(): Array<string> {
    return Array.from(document.querySelectorAll("dt")).map(
      (dt: Element): string => {
        return dt.textContent || "";
      },
    );
  }

  test("draws each field, its name over its value", () => {
    renderRows(NO_KEY_COLUMNS, { isMobile: true });

    expect(fieldNames()).toEqual([
      "About",
      "Answer",
      "What They Wrote",
      "Page",
    ]);

    const answer: HTMLElement = screen.getByTestId("answer-cell");

    expect(answer).toHaveTextContent("5 of 5");
    expect(answer.closest("dd")).not.toBeNull();
    expect(
      within(answer.closest("dl") as HTMLElement).getByText("Answer").tagName,
    ).toBe("DT");
  });

  test("a column with neither an element nor a key is left out of the card", () => {
    renderRows(
      [ABOUT, { id: "nothing", title: "Nothing", type: FieldType.Text }],
      { isMobile: true },
    );

    expect(fieldNames()).toEqual(["About"]);
  });
});

describe("an element column with no key, folded under another column", () => {
  test("draws its value under the column it folds into", () => {
    renderRows([ABOUT], {
      foldedColumns: [
        {
          ...ANSWER_COLUMN,
          hideBelowLargeScreen: true,
          foldInto: "about",
        },
      ],
    });

    const folded: HTMLElement = screen.getByTestId(TABLE_FOLDED_VALUES_TEST_ID);

    expect(within(folded).getByTestId("about-cell")).toHaveTextContent(
      "Know when my website or API is down",
    );
    expect(within(folded).getByTestId("answer-cell")).toHaveTextContent(
      "5 of 5",
    );
  });
});
