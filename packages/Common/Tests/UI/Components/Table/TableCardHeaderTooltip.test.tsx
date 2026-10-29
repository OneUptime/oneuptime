import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import TableRow from "../../../../UI/Components/Table/TableRow";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A column's header tooltip - the (i) beside "Tokens Used" that says how the
 * AI Logs count a call's tokens (#5073), or beside "CPU" what the numbers
 * add up - sits in the table's header row. A phone draws each row as a card
 * and has no header row, so the (i) was nowhere: what a column's numbers
 * mean could not be asked on a phone at all. The card now draws it beside
 * the field's name, the same button the header has, and a tap on it never
 * opens the row.
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
  tokens?: number | undefined;
  cpu?: number | undefined;
}

const TOKENS_TIP: string =
  "As counted toward the project's daily AI limits: a token the provider read from its prompt cache, or wrote to it, counts for what the model charges for it next to a fresh token. On most current models a read counts as a tenth of a token.";

const COLUMNS: Columns<Row> = [
  { key: "name", title: "Name", type: FieldType.Text },
  {
    key: "tokens",
    title: "Tokens Used",
    type: FieldType.Number,
    headerTooltip: TOKENS_TIP,
  },
  // A tooltip of blanks says nothing, so it draws no (i).
  { key: "cpu", title: "CPU", type: FieldType.Number, headerTooltip: "   " },
];

const ITEM: Row = { _id: "1", name: "Investigation", tokens: 9908, cpu: 3 };

function renderCard(rowProps?: React.HTMLAttributes<HTMLElement>): void {
  render(
    <TableRow<Row>
      item={ITEM}
      columns={COLUMNS}
      isMobile={true}
      rowProps={rowProps}
    />,
  );
}

// The card's field (its <dt> and <dd>) for one column title.
function field(title: string): HTMLElement {
  const name: HTMLElement | undefined = screen
    .getAllByRole("term")
    .find((term: HTMLElement) => {
      return (term.textContent || "").trim() === title;
    });

  if (!name || !name.parentElement) {
    throw new Error(`No card field "${title}"`);
  }

  return name.parentElement;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a phone's card", () => {
  test("draws a column's (i) beside the field's name", () => {
    renderCard();

    const tokens: HTMLElement = field("Tokens Used");
    const info: HTMLElement = within(tokens).getByRole("button", {
      name: "About Tokens Used",
    });

    // Beside the name, inside the field's term - not over the value.
    expect(within(tokens).getByRole("term")).toContainElement(info);
    expect(within(tokens).getByRole("definition")).not.toContainElement(info);
    expect(within(tokens).getByRole("definition")).toHaveTextContent("9908");
  });

  test("says what the column means when the (i) is hovered or focused", async () => {
    renderCard();

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Tokens Used",
    });

    fireEvent.mouseEnter(info);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent(TOKENS_TIP);
  });

  test("draws no (i) for a column without a tooltip, or with a blank one", () => {
    renderCard();

    expect(within(field("Name")).queryByRole("button")).toBeNull();
    expect(within(field("CPU")).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(1);
  });

  test("keeps the field's name as the name a screen reader reads", () => {
    renderCard();

    // The (i) is named for its column, so the term reads the title once.
    expect(
      within(field("Tokens Used")).getByRole("term").textContent?.trim(),
    ).toBe("Tokens Used");
  });

  test("a tap on the (i) never opens the row", () => {
    const onClick: MockFunction = getJestMockFunction();
    renderCard({ onClick: onClick as unknown as React.MouseEventHandler });

    fireEvent.click(screen.getByRole("button", { name: "About Tokens Used" }));

    expect(onClick).not.toHaveBeenCalled();

    // The rest of the card still does.
    fireEvent.click(screen.getByText("Investigation"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
