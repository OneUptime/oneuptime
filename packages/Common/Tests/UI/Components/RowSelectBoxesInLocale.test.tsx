import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import Table, { BulkActionProps } from "../../../UI/Components/Table/Table";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import TelemetryViewer, {
  TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID,
  TELEMETRY_VIEWER_SELECT_PAGE_WORDS_TEST_ID,
  TELEMETRY_VIEWER_SELECT_ROW_TEST_ID,
  TelemetryViewerBulk,
} from "../../../UI/Components/TelemetryViewer/TelemetryViewer";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * A ROW'S BOX, AND A LIST'S BOX FOR ITS PAGE, IN THE READER'S LANGUAGE -
 * from the Dashboard's shipped locale files.
 *
 * A table named each row's box "Select Checkout API" in English whatever
 * the reader's language, and the exceptions list - which had no boxes at
 * all until its Bulk Actions (#5248's follow-up) - says "Select all
 * exceptions on this page" over its rows. Both read in the reader's
 * language now, a record's name kept as written in the sentence.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry, so it reaches no
 * other suite.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

interface Row {
  _id: string;
  name: string;
}

const ROWS: Array<Row> = [
  { _id: "1", name: "Checkout API" },
  { _id: "2", name: "TypeError: x is undefined" },
];

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

const tableBulkActions: BulkActionProps<Row> = {
  buttons: [
    {
      title: "Archive",
      icon: IconProp.Archive,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  ],
};

const listBulk: TelemetryViewerBulk<Row> = {
  buttons: [],
  singularLabel: "Exception",
  pluralLabel: "Exceptions",
  getItemId: (row: Row): string => {
    return row._id;
  },
  itemToString: (row: Row): string => {
    return row.name;
  },
};

function renderTable(): void {
  render(
    <Table<Row>
      id="row-boxes-table"
      data={ROWS}
      columns={columns}
      currentPageNumber={1}
      totalItemsCount={ROWS.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
      matchBulkSelectedItemByField="_id"
      bulkActions={tableBulkActions}
      bulkSelectedItems={[]}
      bulkItemToString={(row: Row): string => {
        return row.name;
      }}
    />,
  );
}

function renderList(): void {
  render(
    <TelemetryViewer<Row>
      items={ROWS}
      isLoading={false}
      renderRow={(row: Row): React.ReactElement => {
        return <span>{row.name}</span>;
      }}
      getRowKey={(row: Row): string => {
        return row._id;
      }}
      searchValue=""
      onSearchChange={(): void => {}}
      onSearchSubmit={(): void => {}}
      timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      onTimeRangeChange={(): void => {}}
      page={1}
      pageSize={50}
      totalCount={ROWS.length}
      onPageChange={(): void => {}}
      onPageSizeChange={(): void => {}}
      itemLabel="exceptions"
      bulk={listBulk}
    />,
  );
}

function rowBoxLabels(): Array<string | null> {
  return screen
    .getAllByTestId(TELEMETRY_VIEWER_SELECT_ROW_TEST_ID)
    .map((box: HTMLElement): string | null => {
      return box.getAttribute("aria-label");
    });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
      fa: { translation: readLocale("fa") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("de");
  });
});

afterAll(() => {
  cleanup();
});

describe("a table row's box", () => {
  test("is named in the reader's words, the record's name as written", () => {
    renderTable();

    expect(screen.getByLabelText("Checkout API auswählen")).toBeEnabled();
    expect(screen.queryByLabelText("Select Checkout API")).toBeNull();
  });

  test("reads in Persian on a Persian page", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });
    renderTable();

    expect(screen.getByLabelText("انتخاب Checkout API")).toBeEnabled();
  });

  test("is still named in English for an English reader", async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });
    renderTable();

    expect(screen.getByLabelText("Select Checkout API")).toBeEnabled();
  });
});

describe("a telemetry list's boxes", () => {
  test("say what they select in the reader's words", () => {
    renderList();

    expect(
      screen.getByTestId(TELEMETRY_VIEWER_SELECT_PAGE_WORDS_TEST_ID),
    ).toHaveTextContent("Alle Ausnahmen auf dieser Seite auswählen");
    expect(
      screen.getByTestId(TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID),
    ).toHaveAttribute(
      "aria-label",
      "Alle Ausnahmen auf dieser Seite auswählen",
    );
    expect(rowBoxLabels()).toEqual([
      "Checkout API auswählen",
      "TypeError: x is undefined auswählen",
    ]);
  });

  test("count a selection in the reader's words, as a table's bar does", () => {
    renderList();

    fireEvent.click(
      screen.getAllByTestId(TELEMETRY_VIEWER_SELECT_ROW_TEST_ID)[0]!,
    );

    expect(screen.getByText("1 Ausnahme ausgewählt")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Auswahl aufheben" }),
    ).toBeVisible();
    expect(screen.queryByText(/Selected/)).toBeNull();
  });

  test("read in Persian on a Persian page", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });
    renderList();

    expect(
      screen.getByTestId(TELEMETRY_VIEWER_SELECT_PAGE_WORDS_TEST_ID),
    ).toHaveTextContent("انتخاب همهٔ استثناها این صفحه");
    expect(rowBoxLabels()).toEqual([
      "انتخاب Checkout API",
      "انتخاب TypeError: x is undefined",
    ]);
  });
});
