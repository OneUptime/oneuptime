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
import Pagination, {
  ComponentProps,
} from "../../../UI/Components/Pagination/Pagination";
import Table from "../../../UI/Components/Table/Table";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

/*
 * The pagination control in another language, from the Dashboard's shipped
 * locale files. Every word it draws of its own goes through translation, and
 * a sentence with a number in it is translated whole, so the number lands
 * where each language puts it ("240 件中 1-10 件を表示").
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

const baseProps: ComponentProps = {
  currentPageNumber: 12,
  totalItemsCount: 240,
  itemsOnPage: 10,
  onNavigateToPage: jest.fn(),
  isLoading: false,
  isError: false,
  singularLabel: "Monitor",
  pluralLabel: "Monitore",
};

function renderPagination(overrides?: Partial<ComponentProps>): void {
  render(<Pagination {...baseProps} {...overrides} />);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: { translation: readLocale("de") },
      ja: { translation: readLocale("ja") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("de");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("the pagination control in German", () => {
  test("labels the page size", () => {
    renderPagination();

    expect(screen.getByLabelText("Zeilen pro Seite")).toBe(
      screen.getByTestId("pagination-items-on-page-select"),
    );
    expect(screen.queryByText("Rows per page")).toBeNull();
  });

  test("names the region after the list", () => {
    renderPagination();

    expect(
      screen.getByRole("navigation", { name: "Seitennavigation: Monitore" }),
    ).toBeInTheDocument();
  });

  test("names the arrows", () => {
    renderPagination();

    expect(screen.getByRole("button", { name: "Zur vorherigen Seite" })).toBe(
      screen.getByTestId("pagination-previous-button"),
    );
    expect(screen.getByRole("button", { name: "Zur nächsten Seite" })).toBe(
      screen.getByTestId("pagination-next-button"),
    );
  });

  test("names the pages, the current one and the gaps", () => {
    renderPagination();

    expect(screen.getByTestId("pagination-page-1")).toHaveAccessibleName(
      "Zu Seite 1",
    );
    expect(screen.getByTestId("pagination-page-12")).toHaveAccessibleName(
      "Seite 12",
    );
    expect(screen.getByTestId("pagination-ellipsis-end")).toHaveAccessibleName(
      "Zu einer Seite dazwischen",
    );
    expect(screen.getByTestId("pagination-ellipsis-end")).toHaveAttribute(
      "title",
      "Zu Seite springen",
    );
  });

  test("prints the range without an English noun in it", () => {
    renderPagination();

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Einträge 111-120 von 240",
    );
    expect(screen.getByTestId("pagination-summary")).not.toHaveTextContent(
      /monitor/i,
    );
  });

  test("says there is nothing to show", () => {
    renderPagination({ currentPageNumber: 1, totalItemsCount: 0 });

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Keine Einträge",
    );
  });

  test("says it is loading", () => {
    renderPagination({ isLoading: true });

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Wird geladen...",
    );
  });

  test("marks that more rows follow when the total is unknown", () => {
    renderPagination({
      currentPageNumber: 3,
      totalItemsCount: 31,
      itemsOnCurrentPage: 10,
      hasMore: true,
    });

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Einträge 21-30+",
    );
    expect(
      screen.getByTestId("pagination-current-page-indicator-desktop"),
    ).toHaveTextContent("Seite 3");
  });

  test("shows the page of pages on a narrow screen", () => {
    renderPagination();

    expect(
      screen.getByTestId("pagination-current-page-indicator"),
    ).toHaveTextContent("Seite 12 von 24");
    expect(
      screen.getByTestId("pagination-current-page-indicator"),
    ).toHaveAttribute("title", "Zu Seite springen");
  });

  test("asks for a page in German", () => {
    renderPagination();

    fireEvent.click(screen.getByTestId("pagination-ellipsis-end"));

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Zu Seite springen",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Diese Liste hat 24 Seiten. Geben Sie die Seite ein, die Sie sehen möchten.",
    );
    expect(screen.getByLabelText("Seitennummer")).toBe(
      screen.getByTestId("pagination-go-to-page-input"),
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Zu Seite springen",
    );
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Abbrechen",
    );
  });
});

describe("the pagination control in Japanese", () => {
  test("puts the numbers where Japanese puts them", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ja");
    });

    renderPagination();

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "240 件中 111-120 件を表示",
    );
    expect(
      screen.getByTestId("pagination-current-page-indicator"),
    ).toHaveTextContent("12 / 24 ページ");
    expect(screen.getByLabelText("1ページの行数")).toBeInTheDocument();
    expect(screen.getByTestId("pagination-page-24")).toHaveAccessibleName(
      "24 ページへ移動",
    );
  });
});

describe("switching language", () => {
  test("redraws the bar in the new language", async () => {
    renderPagination();

    expect(screen.getByLabelText("Zeilen pro Seite")).toBeInTheDocument();

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ja");
    });

    expect(screen.getByLabelText("1ページの行数")).toBeInTheDocument();
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "240 件中 111-120 件を表示",
    );
  });

  test("keeps the English sentences, noun and all, in English", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });

    renderPagination({ pluralLabel: "Monitors" });

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 111-120 of 240 monitors",
    );
    expect(screen.getByLabelText("Rows per page")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Pagination for Monitors" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("pagination-current-page-indicator"),
    ).toHaveTextContent("Page 12 of 24");
  });
});

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
}

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

describe("under a German table", () => {
  test("names the region with the table's own translated label", () => {
    render(
      <Table<Row>
        id="german-table"
        columns={columns}
        data={[{ _id: "1", name: "api-gateway" }]}
        currentPageNumber={1}
        totalItemsCount={1}
        itemsOnPage={10}
        onNavigateToPage={() => {}}
        error=""
        isLoading={false}
        singularLabel="Monitor"
        pluralLabel="Monitors"
        sortBy={null}
        sortOrder={SortOrder.Ascending}
        onSortChanged={() => {}}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "Seitennavigation: Monitore" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Einträge 1 von 1",
    );
  });
});
