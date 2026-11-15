import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE ADMIN DASHBOARD'S OWN PAGES, DRAWN IN THE READER'S LANGUAGE (#8227).
 *
 * 186 texts of the Admin Dashboard's own pages had no entry in its locales,
 * so a German, an Arabic or a Persian reader read the whole Feedback page,
 * the Health landing page and its upgrade card in English. Each has an entry
 * now in every Admin locale (App/Tests/AdminDashboard/
 * AdminOwnPagesStringsLocales holds them there), and the two tile lists the
 * Health pages drew in elements of their own - the every-edition tools and
 * the Enterprise card's benefits - look theirs up.
 *
 * This draws the real pages, with i18next set up as the Admin's, in English,
 * German, Arabic and Persian: each reads its words from that language's
 * file, and none of the English is left. The page chrome, the feedback
 * reads and the ClickHouse summary (which fetches) are stand-ins.
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
    default: () => {
      return react.createElement("div", {
        "data-testid": "admin-feedback-switch",
      });
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

// The cards above the tools fetch from the server: not what is read here.
jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacitySummary",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: () => {
        return react.createElement("div", {
          "data-testid": "clickhouse-capacity-summary",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/VisitorAddressesSummary",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: () => {
        return react.createElement("div", {
          "data-testid": "visitor-addresses-summary",
        });
      },
    };
  },
);

import FeedbackPage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Feedback/Index";
import CommunityHealthOverview, {
  EVERY_EDITION_HEALTH_TOOLS,
  HealthTool,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/CommunityHealthOverview";
import EnterpriseHealthUpgrade, {
  EnterpriseHealthNote,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/EnterpriseHealthUpgrade";
import {
  ProductFeedbackKind,
  ProductFeedbackListItem,
  summarizeProductFeedback,
} from "../../../Types/ProductFeedback/ProductFeedback";

type Locale = Record<string, unknown>;

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

const readLocale: (language: string) => Locale = (language: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
};

const ENGLISH: Locale = readLocale("en");

// The languages drawn: a long one, and both read from the right.
const LANGUAGES: Array<string> = ["en", "de", "ar", "fa"];

// The text `language` gives `key`, read from its file.
const wordIn: (language: string, key: string) => string = (
  language: string,
  key: string,
): string => {
  const word: unknown = readLocale(language)[key];

  if (typeof word !== "string") {
    throw new Error(`${language} has no entry for ${key}`);
  }

  return word;
};

// An instance as the Admin's Utils/i18n.ts has it, in `language`.
const instanceFor: (language: string) => Promise<i18n> = async (
  language: string,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [language]: { translation: readLocale(language) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
};

const drawIn: (
  language: string,
  element: ReactElement,
) => Promise<void> = async (
  language: string,
  element: ReactElement,
): Promise<void> => {
  render(
    <I18nextProvider i18n={await instanceFor(language)}>
      {element}
    </I18nextProvider>,
  );
};

// A Give feedback answer and a setup's 5, as the server sends them.
const ANSWERS: Array<ProductFeedbackListItem> = [
  {
    id: "82270000-0000-4000-8000-000000000001",
    kind: ProductFeedbackKind.SetupFlow,
    topic: "website_down",
    score: 5,
    isPositive: null,
    details: "The test page made it obvious that it worked.",
    page: "/dashboard/:projectId/monitors/setup",
    version: "14.2.0",
    createdAt: "2026-11-14T10:15:00.000Z",
  },
];

const serveAnswers: (answers: Array<ProductFeedbackListItem>) => void = (
  answers: Array<ProductFeedbackListItem>,
): void => {
  mockFetchFeedbackSummary.mockResolvedValue({
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
    askAi: { helpful: 2, notHelpful: 1, ratedDown: null },
  } as never);
  mockFetchFeedbackList.mockResolvedValue({
    items: [...answers].reverse(),
    count: answers.length,
  } as never);
};

beforeEach(() => {
  mockFetchFeedbackSummary.mockReset();
  mockFetchFeedbackList.mockReset();
  serveAnswers(ANSWERS);
});

afterEach(() => {
  cleanup();
});

// The page's words, the ones #8227 found with no entry.
const FEEDBACK_WORDS: Array<string> = [
  "By Question",
  "What People Said",
  "Ask AI Answers",
  "How It Went",
  "With Words",
  "Helpful",
  "Not helpful",
];

describe.each(LANGUAGES)(
  "Admin Dashboard > Feedback, in %s",
  (language: string) => {
    test("its cards, columns and counts read in the language", async () => {
      await drawIn(language, <FeedbackPage />);

      await waitFor(() => {
        expect(screen.getByText(wordIn(language, "By Question"))).toBeVisible();
      });

      for (const key of FEEDBACK_WORDS) {
        expect(
          screen.getAllByText(wordIn(language, key)).length,
        ).toBeGreaterThan(0);
      }

      const text: string = document.body.textContent || "";

      if (language !== "en") {
        for (const key of FEEDBACK_WORDS) {
          expect({ key, english: text.includes(key) }).toEqual({
            key,
            english: false,
          });
        }
      }
    });

    test("the setup's average reads as one sentence, its figures in the reader's digits", async () => {
      await drawIn(language, <FeedbackPage />);

      const average: HTMLElement = await screen.findByTestId(
        "admin-feedback-average",
      );
      const digits: (value: number) => string = (value: number): string => {
        return new Intl.NumberFormat(
          language === "ar" ? "ar-u-nu-latn" : language,
        ).format(value);
      };

      expect(average.textContent).toBe(
        wordIn(language, "Average {{average}} of 5, {{hard}} found it hard")
          .replace("{{average}}", digits(5))
          .replace("{{hard}}", digits(0)),
      );
    });

    test("the By Question card's line says the days in the reader's digits", async () => {
      await drawIn(language, <FeedbackPage />);

      const days: string = new Intl.NumberFormat(
        language === "ar" ? "ar-u-nu-latn" : language,
      ).format(90);
      const line: string = wordIn(
        language,
        "What people answered in the last {{days}} days. A guided setup's score runs from 1 (very hard) to 5 (very easy); the hardest setups come first.",
      ).replace("{{days}}", days);

      await waitFor(() => {
        expect(document.body.textContent).toContain(line);
      });
    });

    test("with no answers, the empty states say so in the language", async () => {
      serveAnswers([]);

      await drawIn(language, <FeedbackPage />);

      expect(
        await screen.findByTestId("admin-feedback-summary-empty-title"),
      ).toHaveTextContent(wordIn(language, "No answers yet"));
      expect(
        screen.getByText(
          wordIn(
            language,
            "Answers appear here as people finish guided setups, rate explanations and send Give feedback.",
          ),
        ),
      ).toBeVisible();
    });
  },
);

// The every-edition tools' words: each tile's name and line.
const TOOL_WORDS: Array<string> = EVERY_EDITION_HEALTH_TOOLS.flatMap(
  (tool: HealthTool): Array<string> => {
    return [tool.title, tool.description];
  },
).filter((text: string): boolean => {
  // A product's name reads as written.
  return text !== "ClickHouse";
});

describe.each(LANGUAGES)(
  "Admin Dashboard > Health, in %s",
  (language: string) => {
    test("the every-edition card and each tool's tile read in the language", async () => {
      await drawIn(language, <CommunityHealthOverview />);

      expect(
        screen.getByText(wordIn(language, "Available on every edition")),
      ).toBeVisible();
      expect(
        screen.getByText(
          wordIn(
            language,
            "Capacity, maintenance and support tools for this OneUptime instance.",
          ),
        ),
      ).toBeVisible();

      for (const key of TOOL_WORDS) {
        expect({
          key,
          drawn: screen.queryAllByText(wordIn(language, key)).length > 0,
        }).toEqual({
          key,
          drawn: true,
        });
      }

      // ClickHouse's tile is named as ClickHouse names itself.
      expect(screen.getAllByText("ClickHouse").length).toBeGreaterThan(0);

      if (language !== "en") {
        const text: string = document.body.textContent || "";

        for (const key of TOOL_WORDS) {
          expect({ key, english: text.includes(key) }).toEqual({
            key,
            english: false,
          });
        }
      }
    });

    test("the Enterprise note and the upgrade card's benefits read in the language", async () => {
      await drawIn(
        language,
        <div>
          <EnterpriseHealthNote />
          <EnterpriseHealthUpgrade
            featureName="Query Console"
            featureDescription="Run queries against this instance's datastores."
          />
        </div>,
      );

      const benefits: Array<string> = [
        "Datastore health alerts",
        "PostgreSQL and Valkey storage, connection and memory alerts before you run out.",
        "Query console",
        "Run ad-hoc Postgres, ClickHouse and Valkey queries from the dashboard.",
        "Diagnostics & logs",
        "Datastore diagnostics, job backlogs and recent logs in one place.",
      ];

      expect(
        screen.getByText(wordIn(language, "Live instance health")),
      ).toBeVisible();

      for (const key of benefits) {
        expect({
          key,
          drawn: screen.queryAllByText(wordIn(language, key)).length > 0,
        }).toEqual({
          key,
          drawn: true,
        });
      }

      if (language !== "en") {
        const text: string = document.body.textContent || "";

        for (const key of [...benefits, "Live instance health"]) {
          expect({ key, english: text.includes(key) }).toEqual({
            key,
            english: false,
          });
        }
      }
    });
  },
);

describe("the words drawn are each language's own", () => {
  test("German, Arabic and Persian each word every text drawn here, and the two read from the right differ", () => {
    for (const key of [
      ...FEEDBACK_WORDS,
      ...TOOL_WORDS,
      "Available on every edition",
      "Live instance health",
    ]) {
      for (const language of ["de", "ar", "fa"]) {
        expect({
          language,
          key,
          worded: wordIn(language, key) !== key,
        }).toEqual({
          language,
          key,
          worded: true,
        });
      }

      expect(wordIn("ar", key)).not.toBe(wordIn("fa", key));
    }
  });
});
