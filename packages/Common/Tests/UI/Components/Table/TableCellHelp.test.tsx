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
import userEvent from "@testing-library/user-event";
import * as React from "react";
import TableRow, {
  TABLE_CELL_HELP_TEST_ID,
} from "../../../../UI/Components/Table/TableRow";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A column's help for one row's value (Column.tooltipText) used to open a
 * "Help" dialog on a click anywhere on the cell: Tab never reached it and a
 * screen reader did not know it was there (#9223). It is now an (i) beside
 * the value - a real button, named for its column, whose words show on
 * focus and hover and close with Escape - on a wide table and on a phone's
 * card alike.
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
  quota?: number | undefined;
}

const HELP: string = "Counted since the first of the month.";

const COLUMNS: Columns<Row> = [
  { key: "name", title: "Name", type: FieldType.Text },
  {
    key: "quota",
    title: "Quota",
    type: FieldType.Number,
    tooltipText: (item: Row): string => {
      return item.quota ? HELP : "";
    },
  },
];

function renderRow(
  isMobile: boolean,
  item: Row = { _id: "1", name: "Ingest", quota: 42 },
  rowProps?: React.HTMLAttributes<HTMLElement>,
): void {
  const row: React.ReactElement = (
    <TableRow<Row>
      item={item}
      columns={COLUMNS}
      isMobile={isMobile}
      rowProps={rowProps}
    />
  );

  render(
    isMobile ? (
      row
    ) : (
      <table>
        <tbody>{row}</tbody>
      </table>
    ),
  );
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each([
  ["a wide table's cell", false],
  ["a phone's card", true],
])("the help of %s", (_where: string, isMobile: boolean) => {
  test("is an (i) button named for its column, beside the value", () => {
    renderRow(isMobile);

    const help: HTMLElement = screen.getByTestId(TABLE_CELL_HELP_TEST_ID);

    expect(help.tagName).toBe("BUTTON");
    expect(help).toHaveAccessibleName("About Quota");
    expect(help.parentElement?.closest("td, dd")).toHaveTextContent("42");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Tab reaches it, focus shows its words, and Escape closes them", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      advanceTimers: jest.advanceTimersByTime,
    });
    renderRow(isMobile);

    await user.tab();
    expect(screen.getByTestId(TABLE_CELL_HELP_TEST_ID)).toHaveFocus();
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(HELP);

    await user.keyboard("{Escape}");
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    // The focus stays where it was.
    expect(screen.getByTestId(TABLE_CELL_HELP_TEST_ID)).toHaveFocus();
  });

  test("a press on it never opens the row; the rest of the row still does", () => {
    const onClick: MockFunction = getJestMockFunction();
    renderRow(isMobile, undefined, {
      onClick: onClick as unknown as React.MouseEventHandler,
    });

    fireEvent.click(screen.getByTestId(TABLE_CELL_HELP_TEST_ID));
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Ingest"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("a row whose help is empty draws no (i)", () => {
    renderRow(isMobile, { _id: "2", name: "Archive", quota: 0 });

    expect(screen.queryByTestId(TABLE_CELL_HELP_TEST_ID)).toBeNull();
  });

  test("a click on the cell itself opens nothing", () => {
    renderRow(isMobile);

    const cell: HTMLElement = screen
      .getByTestId(TABLE_CELL_HELP_TEST_ID)
      .closest("td, dd") as HTMLElement;
    fireEvent.click(cell);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(cell).getAllByRole("button")).toHaveLength(1);
  });
});
