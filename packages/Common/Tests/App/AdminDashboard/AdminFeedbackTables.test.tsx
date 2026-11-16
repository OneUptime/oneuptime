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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADMIN DASHBOARD > FEEDBACK DRAWS EVERY ANSWER (#7457).
 *
 * The newcomer walks of 14.0.109, 14.0.110 and 14.0.111 answered "How easy
 * was that?" at the end of a guided setup, with 5 and a few words, and
 * sent Give feedback. The answers were stored, and the page counted them
 * ("Showing 1 of 1 answer"), but By Question and What People Said drew
 * every row empty: each of their ten columns draws its own element and
 * named no key, and the shared table drew nothing for a column with no
 * key (Table/TableRow's getColumnContent; the table now draws an element
 * with or without a key, Table/TableElementColumnWithoutKey).
 *
 * This renders the real page, with its real tables, in the Admin
 * Dashboard's English locale, with one setup answer and one Give feedback
 * answer as the server sends them (ProductFeedbackService's getAdminList,
 * and getAdminSummary's summarizeProductFeedback): every cell of every row
 * holds the row's value - the question, its count, the score and the
 * words, the page and the version. The page's reads and the switch card
 * (a GlobalConfig read of its own) are stand-ins, and so is the page
 * chrome.
 */

jest.setTimeout(60000);

const mockFetchFeedbackSummary: MockFunction = getJestMockFunction();
const mockFetchFeedbackList: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ProductFeedback",
  () => {
    return {
      __esModule: true,
      fetchFeedbackSummary: (...args: Array<unknown>): unknown => {
        return mockFetchFeedbackSummary(...args);
      },
      fetchFeedbackList: (...args: Array<unknown>): unknown => {
        return mockFetchFeedbackList(...args);
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { cardTitle?: string }) => {
      return react.createElement(
        "div",
        { "data-testid": "admin-feedback-switch" },
        props.cardTitle,
      );
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { title?: string; children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "page", "data-title": props.title },
        props.children,
      );
    },
  };
});

import FeedbackPage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Feedback/Index";
import {
  ProductFeedbackAdminSummary,
  ProductFeedbackKind,
  ProductFeedbackListItem,
  ProductFeedbackListPage,
  summarizeProductFeedback,
} from "../../../Types/ProductFeedback/ProductFeedback";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

async function englishInstance(): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: readLocale("en") } },
    interpolation: { escapeValue: false },
  });

  return instance;
}

// "How easy was that?" at the end of Know when my website or API is down.
const SETUP_ANSWER: ProductFeedbackListItem = {
  id: "74570000-0000-4000-8000-000000000001",
  kind: ProductFeedbackKind.SetupFlow,
  topic: "website_down",
  score: 5,
  isPositive: null,
  details: "The test page made it obvious that it worked.",
  page: "/dashboard/:projectId/monitors/setup",
  version: "14.0.111",
  createdAt: "2026-11-14T10:15:00.000Z",
};

// Give feedback, opened from Help.
const GENERAL_ANSWER: ProductFeedbackListItem = {
  id: "74570000-0000-4000-8000-000000000002",
  kind: ProductFeedbackKind.General,
  topic: "help_menu",
  score: null,
  isPositive: null,
  details: "I could not find where to add a second probe.",
  page: "/dashboard/:projectId/monitors",
  version: "14.0.111",
  createdAt: "2026-11-14T10:20:00.000Z",
};

// A Was this clear? thumbs down, with no words.
const EXPLANATION_ANSWER: ProductFeedbackListItem = {
  id: "74570000-0000-4000-8000-000000000003",
  kind: ProductFeedbackKind.Explanation,
  topic: "how_oneuptime_works",
  score: null,
  isPositive: false,
  details: null,
  page: "/dashboard/:projectId/home",
  version: "14.0.111",
  createdAt: "2026-11-14T10:25:00.000Z",
};

// What getAdminSummary sends for these answers.
function summaryOf(
  answers: Array<ProductFeedbackListItem>,
): ProductFeedbackAdminSummary {
  return {
    sinceDays: 90,
    topics: summarizeProductFeedback(
      answers.map((answer: ProductFeedbackListItem) => {
        return {
          kind: answer.kind,
          topic: answer.topic,
          score: answer.score,
          isPositive: answer.isPositive,
          hasDetails: Boolean(answer.details),
        };
      }),
    ),
    askAi: { helpful: 0, notHelpful: 0, ratedDown: null },
  };
}

// What getAdminList sends for these answers: newest first.
function listOf(
  answers: Array<ProductFeedbackListItem>,
): ProductFeedbackListPage {
  return {
    items: [...answers].reverse(),
    count: answers.length,
  };
}

function serve(answers: Array<ProductFeedbackListItem>): void {
  mockFetchFeedbackSummary.mockResolvedValue(summaryOf(answers) as never);
  mockFetchFeedbackList.mockResolvedValue(listOf(answers) as never);
}

async function renderPage(): Promise<void> {
  render(
    <I18nextProvider i18n={await englishInstance()}>
      <FeedbackPage />
    </I18nextProvider>,
  );
}

function tableBody(tableId: string): HTMLElement {
  const body: HTMLElement | null = document.getElementById(`${tableId}-body`);

  expect(body).not.toBeNull();

  return body as HTMLElement;
}

// Each row of a table, as the text of each of its cells, in order.
function rowsOf(tableId: string): Array<Array<string>> {
  return Array.from(tableBody(tableId).querySelectorAll("tr")).map(
    (row: Element): Array<string> => {
      return Array.from(row.querySelectorAll("td"))
        .filter((cell: Element): boolean => {
          // The cell after the columns that takes the room left (TableLayout).
          return !cell.hasAttribute("data-testid");
        })
        .map((cell: Element): string => {
          return (cell.textContent || "").trim();
        });
    },
  );
}

async function waitForRows(tableId: string, count: number): Promise<void> {
  await waitFor(() => {
    expect(rowsOf(tableId)).toHaveLength(count);
  });
}

const SUMMARY_TABLE: string = "admin-feedback-summary";
const LIST_TABLE: string = "admin-feedback-list";

beforeEach(() => {
  mockFetchFeedbackSummary.mockReset();
  mockFetchFeedbackList.mockReset();
  serve([SETUP_ANSWER, GENERAL_ANSWER]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Admin Dashboard > Feedback > By Question", () => {
  test("draws each question's name, kind, count, result and words", async () => {
    await renderPage();
    await waitForRows(SUMMARY_TABLE, 2);

    const [setup, general] = rowsOf(SUMMARY_TABLE) as [
      Array<string>,
      Array<string>,
    ];

    // Question: the setup's name over its kind.
    expect(setup[0]).toContain("Know when my website or API is down");
    expect(setup[0]).toContain("Guided setup");
    // Answers.
    expect(setup[1]).toBe("1");
    // How It Went: the setup's average.
    expect(setup[2]).toBe("Average 5 of 5, 0 found it hard");
    // With Words.
    expect(setup[3]).toBe("1");

    expect(general[0]).toContain("help_menu");
    expect(general[0]).toContain("Give feedback");
    expect(general[1]).toBe("1");
    expect(general[3]).toBe("1");
  });

  test("a Give feedback question has no result to give: the quiet dash, not an empty cell", async () => {
    await renderPage();
    await waitForRows(SUMMARY_TABLE, 2);

    const general: HTMLElement = tableBody(SUMMARY_TABLE).querySelectorAll(
      "tr",
    )[1] as HTMLElement;

    expect(
      within(general).getByTestId("table-empty-value"),
    ).toBeInTheDocument();
  });

  test("an explanation's thumbs read as yes and no", async () => {
    serve([SETUP_ANSWER, EXPLANATION_ANSWER]);

    await renderPage();
    await waitForRows(SUMMARY_TABLE, 2);

    const explanation: Array<string> = rowsOf(
      SUMMARY_TABLE,
    )[1] as Array<string>;

    expect(explanation[0]).toContain("How OneUptime works");
    expect(explanation[0]).toContain("Was this clear?");
    expect(explanation[2]).toBe("0 yes, 1 no");
    expect(explanation[3]).toBe("0");
  });

  test("the average is drawn in its own element", async () => {
    await renderPage();
    await waitForRows(SUMMARY_TABLE, 2);

    expect(screen.getByTestId("admin-feedback-average")).toHaveTextContent(
      "Average 5 of 5, 0 found it hard",
    );
  });
});

describe("Admin Dashboard > Feedback > What People Said", () => {
  test("draws each answer's when, about, answer, words, page and version", async () => {
    await renderPage();
    await waitForRows(LIST_TABLE, 2);

    // Newest first: Give feedback, then the setup's answer.
    const [general, setup] = rowsOf(LIST_TABLE) as [
      Array<string>,
      Array<string>,
    ];

    // When: a date, never an empty cell or the page's dash.
    expect(setup[0]).toMatch(/\d/);
    expect(setup[1]).toContain("Know when my website or API is down");
    expect(setup[1]).toContain("Guided setup");
    expect(setup[2]).toBe("5 of 5");
    expect(setup[3]).toBe("The test page made it obvious that it worked.");
    expect(setup[4]).toBe("/dashboard/:projectId/monitors/setup");
    expect(setup[5]).toBe("14.0.111");

    expect(general[0]).toMatch(/\d/);
    expect(general[1]).toContain("help_menu");
    expect(general[1]).toContain("Give feedback");
    expect(general[3]).toBe("I could not find where to add a second probe.");
    expect(general[4]).toBe("/dashboard/:projectId/monitors");
    expect(general[5]).toBe("14.0.111");
  });

  test("the words are drawn in their own element", async () => {
    await renderPage();
    await waitForRows(LIST_TABLE, 2);

    expect(
      screen
        .getAllByTestId("admin-feedback-details")
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        }),
    ).toEqual([
      "I could not find where to add a second probe.",
      "The test page made it obvious that it worked.",
    ]);
  });

  test("an explanation's thumbs down reads Not clear, and no words is the quiet dash", async () => {
    serve([EXPLANATION_ANSWER]);

    await renderPage();
    await waitForRows(LIST_TABLE, 1);

    const explanation: Array<string> = rowsOf(LIST_TABLE)[0] as Array<string>;

    expect(explanation[1]).toContain("How OneUptime works");
    expect(explanation[2]).toBe("Not clear");
    expect(explanation[4]).toBe("/dashboard/:projectId/home");

    const row: HTMLElement = tableBody(LIST_TABLE).querySelector(
      "tr",
    ) as HTMLElement;

    expect(
      within(row).queryByTestId("admin-feedback-details"),
    ).not.toBeInTheDocument();
    expect(
      (row.querySelectorAll("td")[3] as HTMLElement).querySelector(
        '[data-testid="table-empty-value"]',
      ),
    ).not.toBeNull();
  });

  test("lists the answers the server sends, of the kind picked", async () => {
    await renderPage();
    await waitForRows(LIST_TABLE, 2);

    expect(mockFetchFeedbackList).toHaveBeenCalledWith({
      kind: null,
      skip: 0,
      limit: expect.any(Number),
    });

    mockFetchFeedbackList.mockResolvedValue(listOf([SETUP_ANSWER]) as never);

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Kind" }), {
      key: "ArrowDown",
      code: "ArrowDown",
    });

    const option: HTMLElement = await waitFor(() => {
      const found: HTMLElement | undefined = Array.from(
        document.querySelectorAll<HTMLElement>(".ou-select__option"),
      ).find((candidate: HTMLElement): boolean => {
        return candidate.textContent === "Guided setup";
      });

      if (!found) {
        throw new Error('No "Guided setup" in the Kind menu');
      }

      return found;
    });

    fireEvent.click(option);

    await waitFor(() => {
      expect(mockFetchFeedbackList).toHaveBeenLastCalledWith({
        kind: ProductFeedbackKind.SetupFlow,
        skip: 0,
        limit: expect.any(Number),
      });
    });
    await waitForRows(LIST_TABLE, 1);

    expect((rowsOf(LIST_TABLE)[0] as Array<string>)[2]).toBe("5 of 5");
  });
});

describe("Admin Dashboard > Feedback: a cell with nothing to say", () => {
  // The cells of a table's row that draw the table's quiet dash, by column.
  function quietDashColumns(tableId: string, rowIndex: number): Array<string> {
    const row: Element = tableBody(tableId).querySelectorAll("tr")[
      rowIndex
    ] as Element;
    const headers: Array<string> = Array.from(
      document.querySelectorAll(`#${tableId}-header th`),
    ).map((header: Element): string => {
      return header.getAttribute("aria-label") || "";
    });

    return Array.from(row.querySelectorAll("td"))
      .map((cell: Element, index: number): string | null => {
        return cell.querySelector('[data-testid="table-empty-value"]')
          ? headers[index] || String(index)
          : null;
      })
      .filter((title: string | null): title is string => {
        return title !== null;
      });
  }

  test("is the table's quiet dash, never a hyphen of the page's own", async () => {
    serve([
      {
        ...GENERAL_ANSWER,
        details: null,
        page: "",
        version: "",
        createdAt: "",
      },
    ]);

    await renderPage();
    await waitForRows(LIST_TABLE, 1);

    expect(quietDashColumns(LIST_TABLE, 0)).toEqual([
      "When",
      "Answer",
      "What They Wrote",
      "Page",
      "Version",
    ]);
    // Every empty cell says so the one way.
    expect(
      Array.from(tableBody(LIST_TABLE).querySelectorAll("td")).filter(
        (cell: Element): boolean => {
          return (cell.textContent || "").trim() === "-";
        },
      ),
    ).toHaveLength(0);
    // About still names where Give feedback was opened.
    expect((rowsOf(LIST_TABLE)[0] as Array<string>)[1]).toContain(
      "Give feedback",
    );
  });

  test("Give feedback's How It Went is the quiet dash, and a setup's never is", async () => {
    await renderPage();
    await waitForRows(SUMMARY_TABLE, 2);

    expect(quietDashColumns(SUMMARY_TABLE, 0)).toEqual([]);
    expect(quietDashColumns(SUMMARY_TABLE, 1)).toEqual(["How It Went"]);
  });

  test("an answer with every value draws no quiet dash", async () => {
    serve([SETUP_ANSWER]);

    await renderPage();
    await waitForRows(LIST_TABLE, 1);

    expect(quietDashColumns(LIST_TABLE, 0)).toEqual([]);
  });
});

describe("Admin Dashboard > Feedback on a phone", () => {
  const DESKTOP_WIDTH: number = window.innerWidth;

  function setWindowWidth(width: number): void {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: width,
    });
  }

  beforeEach(() => {
    setWindowWidth(390);
  });

  afterEach(() => {
    setWindowWidth(DESKTOP_WIDTH);
  });

  // Each card of a table, as its fields: name and value.
  function cardsOf(tableId: string): Array<Array<[string, string]>> {
    return Array.from(tableBody(tableId).querySelectorAll("dl")).map(
      (card: Element): Array<[string, string]> => {
        return Array.from(card.querySelectorAll("dt")).map(
          (name: Element): [string, string] => {
            return [
              (name.textContent || "").trim(),
              (name.nextElementSibling?.textContent || "").trim(),
            ];
          },
        );
      },
    );
  }

  test("each question is a card of its values", async () => {
    await renderPage();

    await waitFor(() => {
      expect(cardsOf(SUMMARY_TABLE)).toHaveLength(2);
    });

    const [setup, general] = cardsOf(SUMMARY_TABLE) as [
      Array<[string, string]>,
      Array<[string, string]>,
    ];

    // With Words is left off a phone's card (hideOnMobile).
    expect(
      setup.map(([name]: [string, string]): string => {
        return name;
      }),
    ).toEqual(["Question", "Answers", "How It Went"]);
    expect(setup[0]?.[1]).toContain("Know when my website or API is down");
    expect(setup[1]?.[1]).toBe("1");
    expect(setup[2]?.[1]).toBe("Average 5 of 5, 0 found it hard");

    // Give feedback has no result: the card leaves the field out.
    expect(
      general.map(([name]: [string, string]): string => {
        return name;
      }),
    ).toEqual(["Question", "Answers"]);
  });

  test("each answer is a card of its values", async () => {
    await renderPage();

    await waitFor(() => {
      expect(cardsOf(LIST_TABLE)).toHaveLength(2);
    });

    const setup: Array<[string, string]> = cardsOf(LIST_TABLE)[1] as Array<
      [string, string]
    >;

    // Page and Version are left off a phone's card (hideOnMobile).
    expect(
      setup.map(([name]: [string, string]): string => {
        return name;
      }),
    ).toEqual(["When", "About", "Answer", "What They Wrote"]);
    expect(setup[0]?.[1]).toMatch(/\d/);
    expect(setup[1]?.[1]).toContain("Know when my website or API is down");
    expect(setup[2]?.[1]).toBe("5 of 5");
    expect(setup[3]?.[1]).toBe("The test page made it obvious that it worked.");
  });
});

describe("Admin Dashboard > Feedback: no table draws an empty cell for a row with a value", () => {
  test.each([
    ["By Question", SUMMARY_TABLE, 3],
    ["What People Said", LIST_TABLE, 3],
  ])(
    "%s, with a setup answer, a Give feedback answer and an explanation",
    async (_name: string, tableId: string, count: number) => {
      serve([SETUP_ANSWER, GENERAL_ANSWER, EXPLANATION_ANSWER]);

      await renderPage();
      await waitForRows(tableId, count);

      const rows: Array<Array<string>> = rowsOf(tableId);

      for (const row of rows) {
        expect(row.length).toBeGreaterThan(0);

        for (const cell of row) {
          expect(cell).not.toBe("");
        }
      }
    },
  );
});

/*
 * WHAT AN ANSWER WAS ABOUT, IN THE ADMIN'S LANGUAGE (#8893).
 *
 * The page looks each question's name up by the answer's kind and topic -
 * a guided setup by its name, what Give feedback was about - so no lookup
 * of its own named them, and they read English in every language. Its
 * locales now word them as the Dashboard does.
 */
describe("Admin Dashboard > Feedback in German", () => {
  async function renderInGerman(): Promise<void> {
    const instance: i18n = createInstance();

    await instance.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: readLocale("en") },
        de: { translation: readLocale("de") },
      },
      interpolation: { escapeValue: false },
    });

    render(
      <I18nextProvider i18n={instance}>
        <FeedbackPage />
      </I18nextProvider>,
    );
  }

  test("names each question and its kind in German, Give feedback's kind too", async () => {
    const german: Record<string, unknown> = readLocale("de");

    serve([SETUP_ANSWER, { ...GENERAL_ANSWER, topic: "broken" }]);

    await renderInGerman();
    await waitForRows(SUMMARY_TABLE, 2);

    const [setup, general] = rowsOf(SUMMARY_TABLE) as [
      Array<string>,
      Array<string>,
    ];

    for (const english of [
      "Know when my website or API is down",
      "Guided setup",
      "Something's broken",
      "Give feedback",
    ]) {
      expect(typeof german[english]).toBe("string");
      expect(german[english]).not.toBe(english);
    }

    expect(setup[0]).toContain(german["Know when my website or API is down"]);
    expect(setup[0]).toContain(german["Guided setup"]);
    expect(setup[0]).not.toContain("Know when my website or API is down");
    expect(general[0]).toContain(german["Something's broken"]);
    expect(general[0]).toContain(german["Give feedback"]);
    expect(general[0]).not.toContain("Something's broken");
  });
});
