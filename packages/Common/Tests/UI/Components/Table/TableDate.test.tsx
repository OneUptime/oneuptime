/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import TableDate, {
  TABLE_DATE_TEST_ID,
  getTableDateTexts,
} from "../../../../UI/Components/Table/TableDate";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../Types/GenericObject";

/*
 * Every date a table draws (Table/TableDate): short in the cell - "Oct 7,
 * 2:05 PM", the year only when it is not this year's, and no zone - and
 * whole under the pointer, "Oct 07 2026, 02:05 PM BST".
 *
 * "Incidents, Alerts, Runners, Threat Intel and Execution Logs still scroll
 * at 1280: compact dates" - a date with its time took some 180px in every
 * date column, the widest value left in the lists that still ran past
 * their card.
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

// 7 October 2026, 13:05 UTC: 14:05 in London (BST).
const THIS_YEAR_ISO: string = "2026-10-07T13:05:00.000Z";
const LAST_YEAR_ISO: string = "2025-12-30T22:10:00.000Z";

beforeAll(() => {
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
  jest.spyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(true);
  // "This year" is 2026 here, whenever the suite runs.
  jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockReturnValue(new Date("2026-10-22T06:25:00Z"));
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("TableDate", () => {
  test("a date of this year is short in the cell and whole under the pointer", () => {
    render(<TableDate value={THIS_YEAR_ISO} />);

    const time: HTMLElement = screen.getByTestId(TABLE_DATE_TEST_ID);

    expect(time.tagName).toBe("TIME");
    expect(time).toHaveTextContent("Oct 7, 2:05 PM");
    expect(time).toHaveAttribute("title", "Oct 07 2026, 02:05 PM BST");
    expect(time).toHaveAttribute("datetime", THIS_YEAR_ISO);
  });

  test("a date of another year is the date alone, with its year; its time under the pointer", () => {
    render(<TableDate value={LAST_YEAR_ISO} />);

    const time: HTMLElement = screen.getByTestId(TABLE_DATE_TEST_ID);

    expect(time).toHaveTextContent("Dec 30, 2025");
    expect(time).toHaveAttribute("title", "Dec 30 2025, 10:10 PM GMT");
  });

  test("a day without a time: no time anywhere", () => {
    render(<TableDate value={THIS_YEAR_ISO} onlyShowDate={true} />);

    const time: HTMLElement = screen.getByTestId(TABLE_DATE_TEST_ID);

    expect(time).toHaveTextContent("Oct 7");
    expect(time.textContent).not.toContain(":");
    expect(time).toHaveAttribute("title", "Oct 07, 2026");
  });

  test("takes a Date as well as the text of one", () => {
    render(<TableDate value={new Date(THIS_YEAR_ISO)} />);

    expect(screen.getByTestId(TABLE_DATE_TEST_ID)).toHaveTextContent(
      "Oct 7, 2:05 PM",
    );
  });

  test("a value that is not a date is shown as written, for someone to find and fix", () => {
    render(<TableDate value="Q3 2026" />);

    expect(screen.queryByTestId(TABLE_DATE_TEST_ID)).toBeNull();
    expect(screen.getByText("Q3 2026")).toBeInTheDocument();
    expect(getTableDateTexts({ value: "not-a-date" })).toBeNull();
  });

  test("the texts it writes", () => {
    expect(getTableDateTexts({ value: THIS_YEAR_ISO })).toEqual({
      text: "Oct 7, 2:05 PM",
      fullText: "Oct 07 2026, 02:05 PM BST",
      isoText: THIS_YEAR_ISO,
    });
  });
});

interface Row extends GenericObject {
  _id: string;
  name: string;
  declaredAt?: string | undefined;
  dueOn?: string | undefined;
}

const COLUMNS: Columns<Row> = [
  { key: "name", title: "Name", type: FieldType.Text },
  { key: "declaredAt", title: "Declared", type: FieldType.DateTime },
  { key: "dueOn", title: "Due", type: FieldType.Date },
];

const renderTable: (rows: Array<Row>) => void = (rows: Array<Row>): void => {
  render(
    <Table<Row>
      id="dates"
      data={rows}
      columns={COLUMNS}
      singularLabel="Thing"
      pluralLabel="Things"
      currentPageNumber={1}
      totalItemsCount={rows.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      onNavigateToPage={(): void => {}}
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={(): void => {}}
    />,
  );
};

describe("a table's date columns", () => {
  test("a DateTime and a Date column draw their values short, whole under the pointer", () => {
    renderTable([
      {
        _id: "1",
        name: "Checkout API",
        declaredAt: THIS_YEAR_ISO,
        dueOn: LAST_YEAR_ISO,
      },
    ]);

    const dates: Array<HTMLElement> = screen.getAllByTestId(TABLE_DATE_TEST_ID);

    expect(
      dates.map((date: HTMLElement): string => {
        return date.textContent || "";
      }),
    ).toEqual(["Oct 7, 2:05 PM", "Dec 30, 2025"]);
    expect(dates[0]).toHaveAttribute("title", "Oct 07 2026, 02:05 PM BST");
    expect(dates[1]).toHaveAttribute("title", "Dec 30, 2025");

    // In the row's cells, not a zone in sight.
    const row: HTMLElement = screen.getByText("Checkout API").closest("tr")!;

    expect(row.textContent).not.toContain("BST");
    expect(within(row).getAllByTestId(TABLE_DATE_TEST_ID)).toHaveLength(2);
  });

  test("an empty date is the quiet dash, as before", () => {
    renderTable([{ _id: "1", name: "Checkout API" }]);

    expect(screen.queryByTestId(TABLE_DATE_TEST_ID)).toBeNull();
    expect(screen.getAllByTestId("table-empty-value").length).toBeGreaterThan(
      0,
    );
  });
});
