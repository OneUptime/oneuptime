import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import AiActivityInsightsView from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsView";
import {
  countsInReaderDigits,
  describeTrendDate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import StackedProgressBar from "../../../UI/Components/StackedProgressBar/StackedProgressBar";
import { AiActivityInsights } from "../../../Types/AI/AiActivityInsights";
import Route from "../../../Types/API/Route";
import { createTranslator, Translator } from "../../../Types/Translator";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  DISK_SUBJECT,
  NEXT_STEP,
  ONE_OFF_PROBLEM_TITLE,
  PREVENTIVE_INSIGHT_TITLE,
  RECURRING_PROBLEM_TITLE,
  REPORT_FINDING,
  SECOND_PREVENTIVE_INSIGHT_TITLE,
  STOPPED_PROBLEM_TITLE,
  TLDR_FINDING,
  makeInsights,
  makeTotals,
} from "./AiActivityInsightsFixtures";

/*
 * AI INSIGHTS IN THE READER'S LANGUAGE, ITS COUNTS IN THE READER'S DIGITS
 * (#5715's follow-up).
 *
 * A Persian AI Insights page read its fix bar's legend as "(6)", its
 * problems as "3 fixes proposed · 2 applied", its health notes as "... in
 * the last 30 days", its chart's ends as "2026-09-01", and a few dozen of
 * its sentences in English ("Investigations per day", "Open AI Logs",
 * "See everything AI did in AI Logs"). Every sentence of the page is the
 * reader's language's now, and every count is written as the language
 * writes numbers: Persian digits on a Persian page, "1.240" on a German
 * one. A record's number ("#42") is an identifier, kept as written.
 *
 * Rendered for real (AiActivityInsightsView, the shared StackedProgressBar)
 * through the global i18next the Dashboard sets up, in the fixture the AI
 * Insights suites share (AiActivityInsightsFixtures).
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;
// Two words of Latin letters in a row: English, on a page in another script.
const LATIN_WORDS: RegExp = /[A-Za-z]{2,}[\s'’-]+[A-Za-z]{2,}/;

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

// The incidents' page's insights: coverage, monitors, services, fix tasks.
function incidentInsights(): AiActivityInsights {
  return makeInsights({
    subjectKind: "incident",
    coverage: {
      subjects: 1240,
      investigatedSubjects: 1180,
      notInvestigated: [
        { code: "severity_below_threshold", count: 42 },
        { code: "monitor_cooldown", count: 18 },
      ],
    },
    monitors: [
      {
        id: "77777777-0000-4000-8000-000000000001",
        name: "Checkout API",
        occurrenceCount: 14,
        subjectCount: 14,
        investigationCount: 12,
        problemCount: 2,
        lastSeenAt: "2026-09-29T22:00:00.000Z",
      },
    ],
    services: [
      {
        id: "88888888-0000-4000-8000-000000000001",
        name: "checkout",
        occurrenceCount: 12,
        subjectCount: 12,
        investigationCount: 10,
        problemCount: 1,
        lastSeenAt: "2026-09-30T02:05:00.000Z",
      },
    ],
    fixOutcomes: {
      total: 6,
      planning: 0,
      awaitingApproval: 1,
      appliedAutomatically: 1,
      appliedAfterApproval: 2,
      dismissed: 1,
      noFixFound: 1,
      verified: 2,
      failed: 1,
      verifying: 0,
      approvedFrom: { dashboard: 1, slack: 1, microsoftTeams: 0 },
    },
    fixTaskOutcomes: {
      total: 3,
      pullRequestsOpened: 2,
      noFixFound: 1,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    },
    totals: makeTotals({ commands: 1240 }),
  });
}

function renderView(insights: AiActivityInsights, noun: string): HTMLElement {
  const view: ReturnType<typeof render> = render(
    <MemoryRouter>
      <AiActivityInsightsView
        insights={insights}
        noun={noun}
        logsRoute={new Route("/dashboard/incidents/ai/logs")}
        settingsRoute={new Route("/dashboard/incidents/settings/ai")}
      />
    </MemoryRouter>,
  );

  return view.container;
}

function textsOf(elements: Array<HTMLElement>): Array<string> {
  return elements.map((element: HTMLElement): string => {
    return withoutIsolateMarks(element.textContent || "");
  });
}

/*
 * Every text the page shows - each text node, and each title and
 * aria-label a pointer or a screen reader reads - with the isolates' marks
 * taken out.
 */
function everyTextOf(container: HTMLElement): Array<string> {
  const texts: Array<string> = [];
  const walker: TreeWalker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.nextNode();

  while (node) {
    const text: string = withoutIsolateMarks(node.textContent || "").trim();

    if (text) {
      texts.push(text);
    }

    node = walker.nextNode();
  }

  container
    .querySelectorAll("[title], [aria-label]")
    .forEach((element: Element) => {
      for (const attribute of ["title", "aria-label"]) {
        const value: string | null = element.getAttribute(attribute);

        if (value) {
          texts.push(withoutIsolateMarks(value).trim());
        }
      }
    });

  return texts;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
  // As the Dashboard does: dates follow the reader's language.
  followLanguageForDates(i18next);
});

afterEach(async () => {
  cleanup();
  await inLanguage("en");
});

afterAll(async () => {
  await inLanguage("en");
});

describe("a Persian page writes every count in Persian digits", () => {
  test("the fix bars' legends: (۲), never (2)", async () => {
    await inLanguage("fa");
    renderView(incidentInsights(), "incident");

    const counts: Array<string> = textsOf(
      screen.getAllByTestId("stacked-progress-bar-count"),
    );

    // Five outcomes of the fixes, two of the fix pull requests.
    expect(counts).toHaveLength(7);
    for (const count of counts) {
      expect(count).toMatch(PERSIAN_DIGIT);
      expect(count).not.toMatch(LATIN_DIGIT);
    }
    expect(counts).toContain("(۲)");
  });

  test("the numbers at a glance and the line under each", async () => {
    await inLanguage("fa");
    renderView(incidentInsights(), "incident");

    for (const testId of [
      "ai-insights-stat-investigations",
      "ai-insights-stat-coverage",
      "ai-insights-stat-fixes",
      "ai-insights-stat-commands",
    ]) {
      const stat: string = textsOf([screen.getByTestId(testId)])[0]!;

      expect({ testId, stat }).toEqual({
        testId,
        stat: expect.stringMatching(PERSIAN_DIGIT),
      });
      expect({ testId, latin: LATIN_DIGIT.test(stat) }).toEqual({
        testId,
        latin: false,
      });
    }
  });

  test("the problems' lines, the insights' facts, the health notes, the verification and the trend", async () => {
    await inLanguage("fa");
    renderView(incidentInsights(), "incident");

    const lines: Array<string> = textsOf([
      ...screen.getAllByTestId("ai-insights-insight-facts"),
      ...screen.getAllByTestId("ai-insights-insight-fixes"),
      ...screen.getAllByTestId("ai-insights-insight-verdicts"),
      ...screen.getAllByTestId("ai-insights-health-note"),
      screen.getByTestId("ai-insights-trust"),
      screen.getByTestId("ai-insights-fix-verification"),
      screen.getByTestId("ai-insights-trend-weeks"),
      screen.getByTestId("ai-insights-trend-ends"),
      screen.getByTestId("ai-insights-coverage"),
      ...screen.getAllByTestId("ai-insights-monitors-item"),
      ...screen.getAllByTestId("ai-insights-services-item"),
    ]);

    for (const line of lines) {
      // Names are the system's own: none of these lines holds one.
      expect({ line, latin: LATIN_DIGIT.test(line) }).toEqual({
        line,
        latin: false,
      });
    }

    // The window, in the reader's digits: "... ۳۰ ..." where it read "30".
    expect(
      textsOf(screen.getAllByTestId("ai-insights-health-note")).join(" "),
    ).toContain("۳۰");
  });

  /*
   * Persian writes zero as a dot: "۴ اعمال‌شده · ۲ ..." read "۴۰" and
   * "۲۰" when its facts were joined with a middle dot. They are set apart
   * with a bullet, as every line of Persian facts in the product is
   * (getInlineSeparator, InlineSeparator).
   */
  test("the facts lines are set apart with a bullet: no middle dot beside a Persian digit", async () => {
    await inLanguage("fa");
    renderView(incidentInsights(), "incident");

    const lines: Array<string> = textsOf([
      ...screen.getAllByTestId("ai-insights-insight-fixes"),
      ...screen.getAllByTestId("ai-insights-insight-verdicts"),
      ...screen.getAllByTestId("ai-insights-problem-count"),
      ...screen.getAllByTestId("ai-insights-monitors-item"),
      ...screen.getAllByTestId("ai-insights-services-item"),
    ]);
    const DOT_BESIDE_DIGIT: RegExp =
      /[\u{6F0}-\u{6F9}]\s*\u{B7}|\u{B7}\s*[\u{6F0}-\u{6F9}]/u;

    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      expect({ line, dotBesideDigit: DOT_BESIDE_DIGIT.test(line) }).toEqual({
        line,
        dotBesideDigit: false,
      });
    }
    // The problem's fixes: several facts, set apart as on every Persian line.
    expect(
      textsOf(screen.getAllByTestId("ai-insights-insight-fixes")).join(" "),
    ).toContain(" \u{2022} ");
  });

  test("each bar of the trend says its day and its counts the reader's way", async () => {
    await inLanguage("fa");
    renderView(incidentInsights(), "incident");

    const days: Array<HTMLElement> = screen.getAllByTestId(
      "ai-insights-trend-day",
    );

    expect(days).toHaveLength(30);
    for (const day of days) {
      const title: string = withoutIsolateMarks(
        day.getAttribute("title") || "",
      );

      expect({ title, latin: LATIN_DIGIT.test(title) }).toEqual({
        title,
        latin: false,
      });
    }
    // The day key the server sent stays a data attribute only.
    expect(days[29]).toHaveAttribute("data-date", "2026-09-30");
  });

  test("a part's count beside its name: ×۱۲, its name as the system writes it", async () => {
    await inLanguage("fa");
    // No problem told by an insight: every problem is listed with its parts.
    renderView(makeInsights({ insights: [] }), "cluster");

    const objects: string = textsOf(
      screen.getAllByTestId("ai-insights-problem-objects"),
    ).join(" ");

    expect(objects).toContain("×۱۲");
    expect(objects).not.toContain("×12");
    // "web-7d9f-2xk" is a name, kept as written.
    expect(objects).toContain("web-7d9f-2xk");
  });

  test("a record's number is an identifier, kept as written", async () => {
    await inLanguage("fa");
    renderView(makeInsights(), "cluster");

    const evidence: string = textsOf(
      screen.getAllByTestId("ai-insights-evidence"),
    ).join(" ");

    expect(evidence).toContain(String(DISK_SUBJECT.number));
    expect(evidence).not.toContain("۸۱۲");
  });
});

describe("the system's words read their own way on a Persian page", () => {
  test("an investigation's finding and step, a problem's title and a monitor's name are each set apart (bdi)", async () => {
    await inLanguage("fa");
    renderView(incidentInsights(), "incident");

    // An English sentence keeps its full stop at its own end.
    for (const testId of [
      "ai-insights-finding-text",
      "ai-insights-next-step-text",
    ]) {
      const words: Array<HTMLElement> = screen.getAllByTestId(testId);

      expect(words.length).toBeGreaterThan(0);
      for (const element of words) {
        expect(element.tagName).toBe("BDI");
      }
    }
    expect(
      screen.getAllByTestId("ai-insights-finding-text")[0],
    ).toHaveTextContent(TLDR_FINDING);

    for (const name of within(
      screen.getByTestId("ai-insights-monitors"),
    ).getAllByText("Checkout API")) {
      expect(name.tagName).toBe("BDI");
    }
  });
});

describe("a German page writes its numbers the German way", () => {
  test("1.240 commands, and the coverage's 1.180 of 1.240", async () => {
    await inLanguage("de");
    renderView(incidentInsights(), "incident");

    expect(
      textsOf([screen.getByTestId("ai-insights-stat-commands")])[0],
    ).toContain("1.240");
    expect(
      textsOf([screen.getByTestId("ai-insights-stat-coverage")])[0],
    ).toContain("1.180 von 1.240");
    // Its sentences are German.
    expect(screen.getByTestId("ai-insights-trend")).toHaveTextContent(
      "Untersuchungen pro Tag",
    );
  });

  test("English keeps its own: 1,240", async () => {
    renderView(incidentInsights(), "incident");

    expect(
      textsOf([screen.getByTestId("ai-insights-stat-commands")])[0],
    ).toContain("1,240");
  });
});

/*
 * NO ENGLISH LEFT. On a page in a script that is not Latin, two English
 * words in a row are either the system's own words - a problem's title, a
 * finding OneUptime AI wrote, a monitor's name - or a sentence the page
 * left in English. The fixture's own words are known; nothing else may be
 * English.
 */
describe("every sentence of the page in the reader's words", () => {
  const SYSTEM_WORDS: ReadonlyArray<string> = [
    RECURRING_PROBLEM_TITLE,
    STOPPED_PROBLEM_TITLE,
    ONE_OFF_PROBLEM_TITLE,
    PREVENTIVE_INSIGHT_TITLE,
    SECOND_PREVENTIVE_INSIGHT_TITLE,
    TLDR_FINDING,
    NEXT_STEP,
    REPORT_FINDING,
    DISK_SUBJECT.title || "",
    "Checkout API",
    // The product's name.
    "OneUptime AI",
    "OneUptime",
    "Microsoft Teams",
  ];

  // A word every language here borrows from English as it is.
  const BORROWED_WORDS: RegExp = /pull request/gi;

  function withoutSystemWords(text: string): string {
    let left: string = text.replace(BORROWED_WORDS, " ");

    for (const words of [...SYSTEM_WORDS].sort(
      (a: string, b: string): number => {
        return b.length - a.length;
      },
    )) {
      left = left.split(words).join(" ");
    }

    return left;
  }

  test.each(["fa", "ru", "ja", "ko", "zh-CN", "zh-TW", "hi"])(
    "%s: no sentence of an incidents' or a cluster's AI Insights is English",
    async (language: string) => {
      await inLanguage(language);

      const english: Array<string> = [];

      for (const [insights, noun] of [
        [incidentInsights(), "incident"],
        [makeInsights(), "cluster"],
      ] as Array<[AiActivityInsights, string]>) {
        const container: HTMLElement = renderView(insights, noun);

        for (const text of everyTextOf(container)) {
          if (LATIN_WORDS.test(withoutSystemWords(text))) {
            english.push(text);
          }
        }

        cleanup();
      }

      expect(english).toEqual([]);
    },
  );

  test("English renders its own words, so the check above has something to find", () => {
    const container: HTMLElement = renderView(incidentInsights(), "incident");
    const english: Array<string> = everyTextOf(container).filter(
      (text: string): boolean => {
        return LATIN_WORDS.test(withoutSystemWords(text));
      },
    );

    expect(english).toContain("Investigations per day");
    expect(english).toContain("Open AI Logs");
  });
});

describe("the shared pieces", () => {
  test("StackedProgressBar writes its legend and each segment's hover in the reader's digits", async () => {
    await inLanguage("fa");
    render(
      <StackedProgressBar
        segments={[
          { value: 1240, color: "bg-green-500", label: "Applied" },
          { value: 3, color: "bg-gray-300", label: "Dismissed" },
        ]}
      />,
    );

    expect(
      textsOf(screen.getAllByTestId("stacked-progress-bar-count")),
    ).toEqual(["(۱٬۲۴۰)", "(۳)"]);
    const bar: HTMLElement = screen.getByRole("progressbar");
    const titles: Array<string> = Array.from(bar.children).map(
      (segment: Element): string => {
        return withoutIsolateMarks(segment.getAttribute("title") || "");
      },
    );
    expect(titles).toEqual(["Applied: ۱٬۲۴۰", "Dismissed: ۳"]);
    expect(within(bar.parentElement!).queryByText("(1240)")).toBeNull();
  });

  test("StackedProgressBar in English reads as it always has", () => {
    render(
      <StackedProgressBar
        segments={[{ value: 6, color: "bg-green-500", label: "Applied" }]}
      />,
    );

    expect(
      textsOf(screen.getAllByTestId("stacked-progress-bar-count")),
    ).toEqual(["(6)"]);
    expect(screen.getByRole("progressbar").children[0]).toHaveAttribute(
      "title",
      "Applied: 6",
    );
  });

  test("a segment's own hover is its caller's", () => {
    render(
      <StackedProgressBar
        segments={[
          {
            value: 6,
            color: "bg-green-500",
            label: "Applied",
            tooltip: "Six applied",
          },
        ]}
      />,
    );

    expect(screen.getByRole("progressbar").children[0]).toHaveAttribute(
      "title",
      "Six applied",
    );
  });

  test("countsInReaderDigits writes numbers the reader's way, and leaves everything else", () => {
    const persian: Translator = createTranslator(() => {
      return undefined;
    }, "fa");
    const german: Translator = createTranslator(() => {
      return undefined;
    }, "de");

    expect(
      countsInReaderDigits({ count: 30, total: 1240, name: "node-3" }, persian),
    ).toEqual({ count: "۳۰", total: "۱٬۲۴۰", name: "node-3" });
    expect(countsInReaderDigits({ count: 1240 }, german)).toEqual({
      count: "1.240",
    });
    expect(countsInReaderDigits(undefined, german)).toBeUndefined();
  });

  test.each([
    ["en", "30 Sep"],
    ["de", "30. Sept."],
  ])(
    "describeTrendDate: a UTC day as the %s calendar writes it",
    async (language: string, expected: string) => {
      await inLanguage(language);

      expect(withoutIsolateMarks(describeTrendDate("2026-09-30"))).toBe(
        expected,
      );
    },
  );

  test("describeTrendDate in Persian: the day in Persian digits", async () => {
    await inLanguage("fa");

    const day: string = withoutIsolateMarks(describeTrendDate("2026-09-30"));

    expect(day).toMatch(PERSIAN_DIGIT);
    expect(day).not.toMatch(LATIN_DIGIT);
  });

  test("describeTrendDate keeps a key it cannot read as written", () => {
    expect(describeTrendDate("yesterday")).toBe("yesterday");
    expect(describeTrendDate("2026-9-30")).toBe("2026-9-30");
  });
});
