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
 * ADMIN DASHBOARD > FEEDBACK: HOW LONG ANSWERS ARE KEPT, DELETING ONE, THE
 * DOCS PAGES AND WHAT ASK AI'S ANSWERS RATED DOWN READ (#7366, #7209,
 * #7365).
 *
 *   - What People Said says how long an answer is kept, and each row can
 *     be deleted, after a question that names the answer and quotes its
 *     words; a refusal is said in the dialog.
 *   - On a self-hosted server: the switch that keeps "Was this page
 *     helpful?" on the server, and once it is on - or answers were kept -
 *     the docs pages, the ones that failed people first, with what went
 *     wrong. On OneUptime Cloud neither: its docs send their answers to
 *     product analytics, with consent.
 *   - Ask AI Answers lists what the answers rated down read, on Cloud too,
 *     never a word of them.
 *
 * The real page, in the Admin Dashboard's English locale, with the
 * server's answers stood in for.
 */

jest.setTimeout(60000);

let billingEnabled: boolean = false;

const mockFetchFeedbackSummary: MockFunction = getJestMockFunction();
const mockFetchFeedbackList: MockFunction = getJestMockFunction();
const mockDeleteFeedbackAnswer: MockFunction = getJestMockFunction();
// The docs switch's onChange, as the page handed it.
let docsSwitchOnChange: ((isOn: boolean) => void) | undefined;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });

  return mockedConfig;
});

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
      deleteFeedbackAnswer: (...args: Array<unknown>): unknown => {
        return mockDeleteFeedbackAnswer(...args);
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: {
      cardTitle?: string;
      column?: string;
      dataTestId?: string;
      onChange?: (isOn: boolean) => void;
    }) => {
      if (props.column === "keepDocsFeedback") {
        docsSwitchOnChange = props.onChange;
      }

      return react.createElement(
        "div",
        { "data-testid": props.dataTestId, "data-column": props.column },
        props.cardTitle,
      );
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "page" },
        props.children,
      );
    },
  };
});

import FeedbackPage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Feedback/Index";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { AskAiSourceOfNoProduct } from "../../../Types/AI/AskAiRatings";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  DocsFeedbackReason,
  PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
  ProductFeedbackAdminSummary,
  ProductFeedbackKind,
  ProductFeedbackListItem,
  summarizeDocsPageFeedback,
} from "../../../Types/ProductFeedback/ProductFeedback";

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src/Locales",
);

async function englishInstance(): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
        ) as Record<string, unknown>,
      },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

const GENERAL_ANSWER: ProductFeedbackListItem = {
  id: "73660000-0000-4000-8000-000000000001",
  kind: ProductFeedbackKind.General,
  topic: "broken",
  score: null,
  isPositive: null,
  details: "My name is Maya and the SLO page shows no budget.",
  page: "/dashboard/:projectId/slos",
  version: "16.0.0",
  createdAt: "2026-11-17T09:30:00.000Z",
};

const DOCS_ANSWER: ProductFeedbackListItem = {
  id: "72090000-0000-4000-8000-000000000001",
  kind: ProductFeedbackKind.DocsPage,
  topic: "monitor/website-monitor",
  score: null,
  isPositive: false,
  details: null,
  reason: DocsFeedbackReason.Unclear,
  page: "/docs/de/monitor/website-monitor",
  version: "16.0.0",
  createdAt: "2026-11-17T10:30:00.000Z",
};

function summaryWith(
  overrides: Partial<ProductFeedbackAdminSummary> = {},
): ProductFeedbackAdminSummary {
  return {
    sinceDays: 90,
    retentionInDays: PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
    topics: [],
    docsPages: [],
    askAi: { helpful: 0, notHelpful: 0, ratedDown: null, ratedDownDrewOn: [] },
    ...overrides,
  };
}

function serve(
  items: Array<ProductFeedbackListItem>,
  summary: ProductFeedbackAdminSummary = summaryWith(),
): void {
  mockFetchFeedbackSummary.mockResolvedValue(summary as never);
  mockFetchFeedbackList.mockResolvedValue({
    items: items,
    count: items.length,
  } as never);
}

async function renderPage(): Promise<void> {
  render(
    <I18nextProvider i18n={await englishInstance()}>
      <FeedbackPage />
    </I18nextProvider>,
  );
}

function listRows(): Array<HTMLElement> {
  const body: HTMLElement | null = document.getElementById(
    "admin-feedback-list-body",
  );

  return body ? Array.from(body.querySelectorAll("tr")) : [];
}

// A row's Delete: its one action, drawn as the row's button.
async function openDelete(): Promise<void> {
  const actions: HTMLElement = within(listRows()[0]!).getByTestId(
    "row-actions",
  );

  fireEvent.click(within(actions).getByRole("button", { name: "Delete" }));
}

beforeEach(() => {
  billingEnabled = false;
  docsSwitchOnChange = undefined;
  mockFetchFeedbackSummary.mockReset();
  mockFetchFeedbackList.mockReset();
  mockDeleteFeedbackAnswer.mockReset();
  serve([GENERAL_ANSWER]);
});

afterEach(() => {
  cleanup();
});

describe("What People Said: how long answers are kept, and deleting one (#7366)", () => {
  test("says answers are kept a year, then deleted", async () => {
    await renderPage();

    expect(
      await screen.findByText(
        "Every answer, newest first. Answers are kept 365 days, then deleted. Each carries the page, as a route with no ids, and the OneUptime version, and names no person or project.",
      ),
    ).toBeInTheDocument();
    expect(PRODUCT_FEEDBACK_RETENTION_IN_DAYS).toBe(365);
  });

  test("a row's Delete asks first, naming the answer and quoting its words, then deletes it and reads the list again", async () => {
    mockDeleteFeedbackAnswer.mockResolvedValue(undefined as never);
    await renderPage();

    await waitFor(() => {
      expect(listRows()).toHaveLength(1);
    });
    expect(mockFetchFeedbackList).toHaveBeenCalledTimes(1);

    await openDelete();

    const dialog: HTMLElement = await screen.findByTestId("row-actions-dialog");

    expect(dialog).toHaveTextContent("Delete Answer");
    expect(dialog).toHaveTextContent(
      /Are you sure you want to delete Something's broken · .+\? This action cannot be undone\./,
    );
    expect(
      within(dialog).getByTestId("admin-feedback-delete-words"),
    ).toHaveTextContent("My name is Maya and the SLO page shows no budget.");
    // Nothing is deleted until the question is answered.
    expect(mockDeleteFeedbackAnswer).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    await waitFor(() => {
      expect(mockDeleteFeedbackAnswer).toHaveBeenCalledWith(GENERAL_ANSWER.id);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("row-actions-dialog")).toBeNull();
    });
    // The list and the summary are read again, without the answer.
    await waitFor(() => {
      expect(mockFetchFeedbackList).toHaveBeenCalledTimes(2);
    });
    expect(mockFetchFeedbackSummary).toHaveBeenCalledTimes(2);
  });

  test("a delete the server refuses says why in the dialog, and keeps the row", async () => {
    mockDeleteFeedbackAnswer.mockRejectedValue(
      new HTTPErrorResponse(
        404,
        {
          message:
            "This answer is not on this server any more: it was deleted already, or it was kept longer than answers are. Load the list again.",
        },
        {},
      ) as never,
    );
    await renderPage();

    await waitFor(() => {
      expect(listRows()).toHaveLength(1);
    });
    await openDelete();

    const dialog: HTMLElement = await screen.findByTestId("row-actions-dialog");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("row-actions-dialog")).toHaveTextContent(
        "This answer is not on this server any more",
      );
    });
    expect(mockFetchFeedbackList).toHaveBeenCalledTimes(1);
  });
});

describe("the docs pages, on a self-hosted server (#7209)", () => {
  test("a docs answer reads as helpful or not, with what went wrong, and links to the page it was read on", async () => {
    serve([DOCS_ANSWER]);
    await renderPage();

    await waitFor(() => {
      expect(listRows()).toHaveLength(1);
    });

    const row: HTMLElement = listRows()[0]!;

    expect(row).toHaveTextContent("Not helpful: Hard to follow");
    expect(row).toHaveTextContent("Was this page helpful?");
    expect(
      within(row).getByRole("link", { name: DOCS_ANSWER.page }),
    ).toHaveAttribute("href", "/docs/de/monitor/website-monitor");
  });

  test("the switch that keeps docs answers is offered, and the pages show once there are answers, the ones that failed people first", async () => {
    serve(
      [],
      summaryWith({
        docsPages: summarizeDocsPageFeedback([
          { page: "on-call/escalation-rules", isHelpful: true, reason: null },
          {
            page: "monitor/website-monitor",
            isHelpful: false,
            reason: DocsFeedbackReason.Unclear,
          },
          {
            page: "monitor/website-monitor",
            isHelpful: false,
            reason: DocsFeedbackReason.Unclear,
          },
          {
            page: "monitor/website-monitor",
            isHelpful: false,
            reason: DocsFeedbackReason.Missing,
          },
        ]),
      }),
    );
    await renderPage();

    expect(
      await screen.findByTestId("admin-feedback-docs-switch"),
    ).toHaveTextContent("Docs Feedback");

    const pages: Array<HTMLElement> = await screen.findAllByTestId(
      "admin-feedback-docs-page",
    );

    expect(
      pages.map((page: HTMLElement) => {
        return page.textContent;
      }),
    ).toEqual(["monitor/website-monitor", "on-call/escalation-rules"]);
    expect(pages[0]).toHaveAttribute("href", "/docs/monitor/website-monitor");
    expect(
      screen.getAllByTestId("admin-feedback-docs-not-helpful")[0],
    ).toHaveTextContent("3");
    expect(
      screen.getAllByTestId("admin-feedback-docs-reasons")[0],
    ).toHaveTextContent("Hard to follow·2Something is missing·1");
  });

  test("switched on with no answers yet: an empty state says when pages appear", async () => {
    serve([]);
    await renderPage();

    await screen.findByTestId("admin-feedback-docs-switch");
    expect(screen.queryByTestId("admin-feedback-docs-empty")).toBeNull();

    await act(async () => {
      docsSwitchOnChange?.(true);
    });

    expect(
      await screen.findByTestId("admin-feedback-docs-empty"),
    ).toHaveTextContent(
      "Pages appear here as people answer “Was this page helpful?” at the foot of a docs page.",
    );
  });

  test("on OneUptime Cloud there is no docs switch and no docs pages: its docs send answers to product analytics", async () => {
    billingEnabled = true;
    serve(
      [],
      summaryWith({
        docsPages: summarizeDocsPageFeedback([
          { page: "monitor/website-monitor", isHelpful: true, reason: null },
        ]),
      }),
    );
    await renderPage();

    await screen.findByTestId("admin-feedback-switch");
    expect(screen.queryByTestId("admin-feedback-docs-switch")).toBeNull();
    expect(screen.queryAllByTestId("admin-feedback-docs-page")).toHaveLength(0);
  });
});

describe("Ask AI Answers: what the answers rated down read (#7365)", () => {
  test("on OneUptime Cloud: the products and the docs, counted, and no question", async () => {
    billingEnabled = true;
    serve(
      [],
      summaryWith({
        askAi: {
          helpful: 40,
          notHelpful: 9,
          ratedDown: null,
          ratedDownDrewOn: [
            { source: ProductKey.Logs, answers: 5 },
            { source: AskAiSourceOfNoProduct.Docs, answers: 3 },
            { source: AskAiSourceOfNoProduct.Nothing, answers: 1 },
          ],
        },
      }),
    );
    await renderPage();

    const sources: Array<HTMLElement> = await screen.findAllByTestId(
      "admin-feedback-ask-ai-source",
    );

    expect(
      sources.map((source: HTMLElement) => {
        return source.textContent;
      }),
    ).toEqual(["Logs5", "OneUptime docs3", "No data read1"]);
    expect(screen.queryByTestId("admin-feedback-ask-ai-rated-down")).toBeNull();
    expect(
      screen.getByText(
        "How people rated Ask AI's answers in the last 90 days, and what the answers rated down read. The questions belong to each project, so none is shown.",
      ),
    ).toBeInTheDocument();
  });

  test("with nothing rated down, no list", async () => {
    await renderPage();

    await screen.findByTestId("admin-feedback-ask-ai");
    expect(screen.queryByTestId("admin-feedback-ask-ai-drew-on")).toBeNull();
  });
});
