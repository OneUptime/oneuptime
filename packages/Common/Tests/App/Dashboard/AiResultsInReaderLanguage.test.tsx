import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import AiResultsView from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsView";
import {
  AiResultsCard,
  AiResultsCardKind,
  describeAiResultsPartial,
  describeRecentWeeks,
  getAiResultsCards,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import SettingsAIResults from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIResults";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { AiOutcomes, AiOutcomesWeek } from "../../../Types/AI/AiOutcomes";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import API from "../../../UI/Utils/API/API";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import {
  AI_RESULTS_WEEK_STARTS,
  makeEmptyOutcomes,
  makeOutcomes,
  toBody,
} from "./AiResultsFixtures";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * AI RESULTS IN THE READER'S DIGITS (issue #6800). Every count the page
 * shows - each card's number, what it is out of, the breakdowns' legends,
 * the facts, each week's bar, the line under the bars, the partial note -
 * is written as the reader's language writes numbers: Persian digits on a
 * Persian page, "1.234" on a German one. Rendered for real through the
 * global i18next the Dashboard sets up. The page's sentences are being
 * translated as this is written, so nothing here reads a translation's
 * words: only its numbers.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

/*
 * A date inside a sentence the reader's language has not worded yet is
 * written in English, as the sentence is (the Translator's
 * englishDateValues): "Week of 22 Aug: ۰ of ۲ ...". The page's sentences
 * are being translated as this is written, so such a date may be either;
 * the counts are in the reader's digits both ways.
 */
const ENGLISH_DAY_MONTH: RegExp =
  /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;

function hasLatinCount(text: string): boolean {
  return LATIN_DIGIT.test(text.replace(ENGLISH_DAY_MONTH, ""));
}

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

// Counts a German or an English page must group: four digits and more.
function bigOutcomes(overrides: Partial<AiOutcomes> = {}): AiOutcomes {
  const weeks: Array<AiOutcomesWeek> = makeOutcomes().weeks.map(
    (week: AiOutcomesWeek, index: number): AiOutcomesWeek => {
      return index === 11
        ? {
            ...week,
            pagesAvoided: 1234,
            pagesHeld: 5678,
            fixesVerified: 2048,
            fixesChecked: 4096,
            rootCausesConfirmed: 1500,
            rootCausesJudged: 3000,
          }
        : week;
    },
  );

  return makeOutcomes({
    pages: {
      resolvedByAi: 1234,
      recoveredOnItsOwn: 1111,
      handledByPerson: 1000,
      handedOff: 2222,
      holdTimeRanOut: 50,
      pageNowPressed: 61,
      holding: 1300,
    },
    remediationFixes: {
      verified: 2000,
      failed: 1000,
      pending: 1200,
      skipped: 3000,
    },
    pullRequestFixes: {
      verified: 48,
      regressed: 1048,
      watching: 7,
      awaitingDeploy: 1,
      unverifiable: 1999,
    },
    rootCauses: {
      confirmed: 1500,
      partial: 1000,
      wrong: 500,
      judgedByPeople: 1200,
      completed: 4321,
    },
    weeks,
    isPartial: true,
    ...overrides,
  });
}

function renderView(outcomes: AiOutcomes): HTMLElement {
  const view: ReturnType<typeof render> = render(
    <MemoryRouter>
      <AiResultsView outcomes={outcomes} />
    </MemoryRouter>,
  );

  return view.container;
}

function textsOf(elements: Array<Element>): Array<string> {
  return elements.map((element: Element): string => {
    return withoutIsolateMarks(element.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  });
}

/*
 * Every text that carries a count: the cards' numbers and headlines, the
 * legends, the facts, the bars' hovers, the weeks' ends, the lines under the
 * bars and the cards, the start notes and the partial note.
 */
function countTexts(): Array<string> {
  const bars: Array<string> = screen
    .queryAllByTestId("ai-results-week")
    .map((bar: HTMLElement): string => {
      return withoutIsolateMarks(bar.getAttribute("title") || "");
    });

  return [
    ...textsOf(screen.queryAllByTestId("ai-results-value")),
    ...textsOf(screen.queryAllByTestId("ai-results-headline")),
    ...textsOf(screen.queryAllByTestId("stacked-progress-bar-count")),
    ...textsOf(
      screen.queryAllByTestId("ai-results-fact").map((fact: HTMLElement) => {
        return fact.querySelector("dd")!;
      }),
    ),
    ...textsOf(screen.queryAllByTestId("ai-results-weeks-ends")),
    ...textsOf(screen.queryAllByTestId("ai-results-recent-weeks")),
    ...textsOf(screen.queryAllByTestId("ai-results-start")),
    ...textsOf(screen.queryAllByTestId("ai-results-partial")),
    ...textsOf(screen.queryAllByTestId("ai-results-window")),
    ...bars,
  ];
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

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getCurrentTimezone")
    .mockReturnValue("UTC" as Timezone);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await inLanguage("en");
});

afterAll(async () => {
  await inLanguage("en");
});

describe("a Persian page writes every count in Persian digits", () => {
  test("each card's number, out of what it counts", async () => {
    await inLanguage("fa");
    renderView(makeOutcomes());

    expect(textsOf(screen.getAllByTestId("ai-results-value"))).toEqual([
      "۱۷",
      "۱۱",
      "۱۱",
    ]);

    const headlines: Array<string> = textsOf(
      screen.getAllByTestId("ai-results-headline"),
    );

    expect(headlines).toHaveLength(3);
    // What each is out of: 35 held pages, 16 checked fixes, 16 judged.
    expect(headlines[0]).toContain("۳۵");
    expect(headlines[1]).toContain("۱۶");
    expect(headlines[2]).toContain("۱۶");
    for (const headline of headlines) {
      expect({ headline, latin: LATIN_DIGIT.test(headline) }).toEqual({
        headline,
        latin: false,
      });
    }
  });

  test("the legends, the facts, the bars, the lines under them, and the window", async () => {
    await inLanguage("fa");
    renderView(makeOutcomes({ isPartial: true }));

    const texts: Array<string> = countTexts();

    // 3 values, 3 headlines, 18 legends, 4 facts, 3 ends, 3 lines, partial, window, 36 bars.
    expect(texts.length).toBeGreaterThan(60);
    for (const text of texts) {
      expect({ text, latin: hasLatinCount(text) }).toEqual({
        text,
        latin: false,
      });
    }
    expect(
      textsOf(screen.getAllByTestId("stacked-progress-bar-count")),
    ).toContain("(۱۷)");
    expect(
      textsOf(screen.getAllByTestId("ai-results-recent-weeks"))[0],
    ).toContain("۱۵");
    // The scan limit: 5,000 in Persian digits.
    expect(textsOf([screen.getByTestId("ai-results-partial")])[0]).toMatch(
      /۵.?۰۰۰/,
    );
  });

  test("each bar's hover says its week and its counts in Persian digits; its data stays the server's", async () => {
    await inLanguage("fa");
    renderView(makeOutcomes());

    const bars: Array<HTMLElement> = within(
      screen.getByTestId("ai-results-card-pages-avoided"),
    ).getAllByTestId("ai-results-week");

    expect(bars).toHaveLength(12);
    for (const bar of bars) {
      const title: string = withoutIsolateMarks(
        bar.getAttribute("title") || "",
      );

      // A week with no held pages says so in words: no count to write.
      if (bar.getAttribute("data-total") !== "0") {
        expect(title).toMatch(PERSIAN_DIGIT);
      }
      expect({ title, latin: hasLatinCount(title) }).toEqual({
        title,
        latin: false,
      });
    }
    // The keys the server sent stay data attributes, as sent.
    expect(bars[11]).toHaveAttribute(
      "data-week-start",
      AI_RESULTS_WEEK_STARTS[11],
    );
    expect(bars[11]).toHaveAttribute("data-value", "2");
    expect(bars[11]).toHaveAttribute("data-total", "3");
  });

  test("the start notes count in Persian digits too", async () => {
    await inLanguage("fa");
    renderView(
      makeEmptyOutcomes({
        pages: {
          resolvedByAi: 0,
          recoveredOnItsOwn: 0,
          handledByPerson: 0,
          handedOff: 0,
          holdTimeRanOut: 0,
          pageNowPressed: 0,
          holding: 3,
        },
        remediationFixes: { verified: 0, failed: 0, pending: 2, skipped: 0 },
        rootCauses: {
          confirmed: 0,
          partial: 0,
          wrong: 0,
          judgedByPeople: 0,
          completed: 7,
        },
      }),
    );

    const notes: Array<string> = textsOf(
      screen.getAllByTestId("ai-results-start"),
    );

    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain("۳");
    expect(notes[1]).toContain("۲");
    expect(notes[2]).toContain("۷");
    for (const note of notes) {
      expect({ note, latin: LATIN_DIGIT.test(note) }).toEqual({
        note,
        latin: false,
      });
    }
  });

  test("the data the page is drawn from is written the same way", async () => {
    await inLanguage("fa");

    const cards: Array<AiResultsCard> = getAiResultsCards(makeOutcomes());

    for (const card of cards) {
      expect({
        kind: card.kind,
        latin: LATIN_DIGIT.test(card.recentWeeks),
      }).toEqual({ kind: card.kind, latin: false });
    }
    expect(
      describeRecentWeeks(makeOutcomes().weeks, (week: AiOutcomesWeek) => {
        return { value: week.pagesAvoided, total: week.pagesHeld };
      }),
    ).toMatch(PERSIAN_DIGIT);
    expect(describeAiResultsPartial()).not.toMatch(LATIN_DIGIT);
    // A card's kind is a key, not a sentence.
    expect(cards[0]!.kind).toBe(AiResultsCardKind.PagesAvoided);
  });
});

describe("a German page groups its thousands the German way", () => {
  test("1.234 of 5.678 held pages, (1.234) in the legend, 1.300 still held", async () => {
    await inLanguage("de");
    renderView(bigOutcomes());

    const pages: HTMLElement = screen.getByTestId(
      "ai-results-card-pages-avoided",
    );

    expect(textsOf([within(pages).getByTestId("ai-results-value")])).toEqual([
      "1.234",
    ]);
    // 1234 + 1111 + 1000 + 2222 + 50 + 61 held pages ended.
    expect(
      textsOf([within(pages).getByTestId("ai-results-headline")])[0],
    ).toContain("5.678");
    expect(
      textsOf(within(pages).getAllByTestId("stacked-progress-bar-count")),
    ).toEqual(["(1.234)", "(1.111)", "(1.000)", "(2.222)", "(50)", "(61)"]);
    expect(
      textsOf(
        within(pages)
          .getAllByTestId("ai-results-fact")
          .map((fact: HTMLElement) => {
            return fact.querySelector("dd")!;
          }),
      ),
    ).toEqual(["1.300"]);
  });

  test("the bars, the line under them and the partial note", async () => {
    await inLanguage("de");
    renderView(bigOutcomes());

    const pages: HTMLElement = screen.getByTestId(
      "ai-results-card-pages-avoided",
    );
    const lastBar: HTMLElement =
      within(pages).getAllByTestId("ai-results-week")[11]!;

    expect(withoutIsolateMarks(lastBar.getAttribute("title") || "")).toContain(
      "1.234",
    );
    expect(withoutIsolateMarks(lastBar.getAttribute("title") || "")).toContain(
      "5.678",
    );

    const line: string = textsOf([
      within(pages).getByTestId("ai-results-recent-weeks"),
    ])[0]!;

    // The last four weeks: 1 + 3 + 4 + 1,234 of 2 + 4 + 6 + 5,678.
    expect(line).toContain("1.242");
    expect(line).toContain("5.690");
    expect(line).not.toContain("1,242");
    expect(textsOf([screen.getByTestId("ai-results-partial")])[0]).toContain(
      "5.000",
    );
  });

  test("no count on the page is grouped the English way", async () => {
    await inLanguage("de");
    renderView(bigOutcomes());

    // "1,234": thousands grouped with a comma.
    const englishGrouping: RegExp = /\d,\d{3}/;

    for (const text of countTexts()) {
      expect({ text, english: englishGrouping.test(text) }).toEqual({
        text,
        english: false,
      });
    }
  });

  test("English keeps its own: 1,234", async () => {
    renderView(bigOutcomes());

    expect(
      textsOf([
        within(screen.getByTestId("ai-results-card-pages-avoided")).getByTestId(
          "ai-results-value",
        ),
      ]),
    ).toEqual(["1,234"]);
    expect(textsOf([screen.getByTestId("ai-results-partial")])[0]).toContain(
      "5,000",
    );
  });
});

describe("the real page, on a Persian reader's screen", () => {
  const PAGE_PATH: string = RouteMap[
    PageMap.SETTINGS_AI_RESULTS
  ]!.toString().replace(":projectId", PROJECT_ID);

  beforeEach(() => {
    window.localStorage.clear();
    PermissionGate.clearPermissionPropsCache();
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (request: unknown): Promise<HTTPResponse<JSONObject>> => {
          const url: string = String((request as JSONObject)["url"]);

          if (url.endsWith("/ai-activity/outcomes")) {
            return new HTTPResponse<JSONObject>(
              200,
              toBody(makeOutcomes({ isPartial: true })),
              {},
            );
          }

          if (url.endsWith("/ai-chat/providers")) {
            return new HTTPResponse<JSONObject>(
              200,
              {
                isAIEnabledForProject: true,
                defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
                providers: [
                  {
                    id: "9d9d9d9d-0000-4000-8000-000000000001",
                    name: "OneUptime AI",
                    isGlobal: true,
                    isDefault: false,
                  },
                ],
              },
              {},
            );
          }

          throw new Error(`Unexpected request to ${url}`);
        },
      );
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<Project> => {
        return Object.assign(new Project(), {
          _id: PROJECT_ID,
          enableAi: true,
        });
      });
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectOwner]);
  });

  test("every count it loads is in Persian digits", async () => {
    await inLanguage("fa");
    goTo(PAGE_PATH);

    render(
      <MemoryRouter initialEntries={[PAGE_PATH]}>
        <Routes>
          <PageRoute
            path={RouteMap[PageMap.SETTINGS_AI_RESULTS]!.toString()}
            element={
              <SettingsAIResults
                pageRoute={RouteMap[PageMap.SETTINGS_AI_RESULTS] as Route}
                currentProject={null}
                hasPaymentMethod={true}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId("ai-results-window", {}, { timeout: 20000 });

    expect(textsOf(screen.getAllByTestId("ai-results-value"))).toEqual([
      "۱۷",
      "۱۱",
      "۱۱",
    ]);
    expect(screen.getAllByTestId("ai-results-week")).toHaveLength(36);

    const texts: Array<string> = countTexts();

    expect(texts.length).toBeGreaterThan(60);
    for (const text of texts) {
      expect({ text, latin: hasLatinCount(text) }).toEqual({
        text,
        latin: false,
      });
    }
  });
});
