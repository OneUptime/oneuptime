import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import TableRow from "../../../../UI/Components/Table/TableRow";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * A column a phone's card draws without its name (Column.hideTitleOnMobile).
 *
 * A phone draws each row as a card of its columns, each value under its
 * column's name. For a card that is one field - a Kubernetes event, its
 * reason and message, with its object, count and time folded into it - the
 * same "Event" over every card says nothing. The name is kept for screen
 * readers (the <dt> stays, visually hidden), and an (i) the column's header
 * carries is not put where nobody can see it.
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
  event?: string | undefined;
  count?: number | undefined;
}

const COLUMNS: Columns<Row> = [
  {
    key: "event",
    title: "Event",
    type: FieldType.Text,
    hideTitleOnMobile: true,
    headerTooltip: "What happened.",
  },
  {
    key: "count",
    title: "Count",
    type: FieldType.Number,
    headerTooltip: "How many times.",
  },
];

const ITEM: Row = { _id: "1", event: "OOMKilling", count: 2 };

// A phone's card of the row (TableRow draws a card, not a <tr>, when isMobile).
function renderCard(): void {
  render(<TableRow<Row> item={ITEM} columns={COLUMNS} isMobile={true} />);
}

function term(title: string): HTMLElement {
  const found: HTMLElement | undefined = screen
    .getAllByRole("term")
    .find((element: HTMLElement): boolean => {
      return (element.textContent || "").trim() === title;
    });

  if (!found) {
    throw new Error(`No term "${title}"`);
  }

  return found;
}

afterEach(() => {
  cleanup();
});

describe("a column a phone's card draws without its name", () => {
  test("keeps its name for screen readers only, with its value in full", () => {
    renderCard();

    const name: HTMLElement = term("Event");
    expect(name).toHaveClass("sr-only");
    expect(name.parentElement).toHaveTextContent("OOMKilling");
  });

  test("puts no (i) where nobody can see it", () => {
    renderCard();

    expect(within(term("Event")).queryByRole("button")).toBeNull();
    // The column beside it keeps its name, and its (i).
    expect(term("Count")).not.toHaveClass("sr-only");
    expect(
      within(term("Count")).getByRole("button", { name: "About Count" }),
    ).toBeInTheDocument();
  });

  test("a column without it keeps its name over its value", () => {
    renderCard();

    expect(term("Count").className).toContain("text-xs");
  });
});
