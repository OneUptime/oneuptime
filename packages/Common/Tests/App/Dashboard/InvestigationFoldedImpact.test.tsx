import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHO AND WHAT IT HURTS, ON THE FOLDED INVESTIGATION STEP (#5715's
 * follow-up: "Impact shows only in the full investigation report, not on the
 * folded Investigation step. Show its lines there too.").
 *
 * A finished investigation folds to its summary. The run records the
 * report's impact as short numbers (an InvestigationImpact event), and the
 * folded step draws them under the summary, one line each, with the marks
 * the full report's Impact lines have: the users (or sessions, or
 * requests), the services, the SLOs. What was not measured is left out; a
 * run that recorded none - an older one, or one whose answer measured
 * nothing - shows the summary alone, as before. Opened, the report's own
 * Impact section says it in full instead.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "investigation-markdown" },
        props.text,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "evidence-widget" });
      },
    };
  },
);

import InvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import {
  getInvestigationImpactLines,
  INVESTIGATION_IMPACT_LIST_LABEL,
  INVESTIGATION_IMPACT_SERVICES_WORDS,
  INVESTIGATION_IMPACT_SLOS_WORDS,
  INVESTIGATION_IMPACT_USERS_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationImpactCopy";
import AIRunCodeFixRecommendation from "../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../Types/Translator";
import { InvestigationImpactCounted } from "../../../Utils/AI/InvestigationImpactNumbers";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

const COMPLETED_AT: string = "2026-10-29T12:00:00.000Z";
const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TLDR: string =
  "checkout-api restarted with its pool cut from 40 to 10 connections, so checkout requests queued.";
const ANALYSIS: string = [
  "**Summary** — checkout requests queued for a database connection.",
  "",
  "**Impact** —",
  "- **Users:** about 1,240 failed requests between 17:58 and 18:11 UTC.",
  "- **Services:** checkout-api and the storefront.",
  "- **SLOs:** Checkout latency is at risk.",
  "",
  "**Most likely root cause** — the pool was cut from 40 to 10.",
].join("\n");

const ALL_THREE: JSONObject = {
  users: { count: 1240, counted: "requests" },
  services: { count: 2 },
  slos: { affected: 1, total: 2 },
};

let eventSequence: number = 0;

function event(
  eventType: AIRunEventType,
  resultSummary?: JSONObject,
): JSONObject {
  eventSequence++;
  return {
    _id: ObjectID.generate().toString(),
    sequence: eventSequence,
    eventType,
    ...(resultSummary ? { resultSummary } : {}),
    createdAt: COMPLETED_AT,
  };
}

function impact(impactNumbers: unknown): JSONObject {
  return event(AIRunEventType.InvestigationImpact, {
    message: "Affected: 1240 requests, 2 services, 1 of 2 SLOs.",
    impactNumbers: impactNumbers as JSONObject,
  });
}

function payload(data: {
  events: Array<JSONObject>;
  analysisMarkdown?: string | null | undefined;
  isAnalysisPending?: boolean | undefined;
}): { data: JSONObject } {
  const analysisMarkdown: string | null =
    data.analysisMarkdown === undefined ? ANALYSIS : data.analysisMarkdown;

  return {
    data: {
      run: {
        _id: RUN_ID,
        status: AIRunStatus.Completed,
        errorMessage: null,
        toolCallCount: 3,
        totalTokens: 1234,
        humanVerdict: null,
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        completedAt: COMPLETED_AT,
      },
      events: data.events as unknown as JSONArray,
      analysisMarkdown,
      analysisTldr: analysisMarkdown ? TLDR : null,
      isAnalysisPending: data.isAnalysisPending === true,
      evidence: [],
      references: [],
      clusterAccess: [],
    },
  };
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 8; index++) {
      await Promise.resolve();
    }
  });
}

async function renderPanel(
  events: Array<JSONObject>,
  options: {
    analysisMarkdown?: string | null;
    isAnalysisPending?: boolean;
  } = {},
): Promise<void> {
  postMock.mockResolvedValue(
    payload({
      events,
      analysisMarkdown: options.analysisMarkdown,
      isAnalysisPending: options.isAnalysisPending,
    }) as never,
  );

  render(<InvestigationPanel subjectType="incident" subjectId={INCIDENT_ID} />);

  await flush();
}

function completedRun(...extra: Array<JSONObject>): Array<JSONObject> {
  return [
    event(AIRunEventType.RunStarted),
    ...extra,
    event(AIRunEventType.RunCompleted),
  ];
}

function impactList(): HTMLElement | null {
  return screen.queryByTestId("investigation-folded-impact");
}

function impactLines(): Array<{ aspect: string | null; text: string }> {
  return screen
    .queryAllByTestId("investigation-folded-impact-line")
    .map((line: HTMLElement) => {
      return {
        aspect: line.getAttribute("data-aspect"),
        text: withoutIsolateMarks(line.textContent || ""),
      };
    });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(COMPLETED_AT));
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  eventSequence = 0;
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  postMock.mockReset();
});

describe("the folded Investigation step says who and what it hurts", () => {
  test("all three, under the summary, in the report's order, each with the full report's mark", async () => {
    await renderPanel(completedRun(impact(ALL_THREE)));

    expect(screen.getByTestId("investigation-report-folded")).toBeVisible();
    expect(impactLines()).toEqual([
      { aspect: "Users", text: "1,240 requests affected" },
      { aspect: "Services", text: "2 services affected" },
      { aspect: "Slos", text: "1 of 2 SLOs affected" },
    ]);

    // Right under the summary, in the same block.
    const summary: HTMLElement = screen.getByTestId(
      "investigation-report-summary",
    );
    expect(summary.nextElementSibling).toBe(impactList());

    // A list a screen reader names as the report's own section is named.
    expect(impactList()).toHaveAttribute("aria-label", "Impact");
    expect(impactList()!.tagName).toBe("UL");

    // Each line its mark, quiet words: never a pill or a box.
    for (const line of screen.getAllByTestId(
      "investigation-folded-impact-line",
    )) {
      expect(line.querySelector("svg")).not.toBeNull();
      expect(line.className).not.toMatch(/rounded|border|bg-/);
    }
  });

  test("only what was measured: the SLOs alone", async () => {
    await renderPanel(
      completedRun(impact({ slos: { affected: 0, total: 3 } })),
    );

    expect(impactLines()).toEqual([
      { aspect: "Slos", text: "0 of 3 SLOs affected" },
    ]);
  });

  test("users counted as what they were: users, sessions or requests", async () => {
    await renderPanel(
      completedRun(
        impact({
          users: { count: 38, counted: "sessions" },
          services: { count: 1 },
        }),
      ),
    );

    expect(impactLines()).toEqual([
      { aspect: "Users", text: "38 sessions affected" },
      { aspect: "Services", text: "1 service affected" },
    ]);
  });

  test("one of each reads as one", async () => {
    await renderPanel(
      completedRun(
        impact({
          users: { count: 1, counted: "users" },
          services: { count: 1 },
          slos: { affected: 1, total: 1 },
        }),
      ),
    );

    expect(impactLines()).toEqual([
      { aspect: "Users", text: "1 user affected" },
      { aspect: "Services", text: "1 service affected" },
      { aspect: "Slos", text: "1 of 1 SLO affected" },
    ]);
  });

  test("a run that recorded none - an older one, or one that measured nothing - shows the summary alone", async () => {
    await renderPanel(completedRun());

    expect(screen.getByTestId("investigation-report-summary")).toBeVisible();
    expect(impactList()).toBeNull();
  });

  test("numbers that do not hold together draw nothing", async () => {
    await renderPanel(
      completedRun(
        impact({
          users: { count: -4, counted: "requests" },
          slos: { affected: 5, total: 2 },
        }),
      ),
    );

    expect(impactList()).toBeNull();
  });

  test("the newest record is the one drawn", async () => {
    await renderPanel(
      completedRun(
        impact({ services: { count: 1 } }),
        impact({ services: { count: 4 } }),
      ),
    );

    expect(impactLines()).toEqual([
      { aspect: "Services", text: "4 services affected" },
    ]);
  });

  test("opened, the report's own Impact section says it in full instead", async () => {
    await renderPanel(completedRun(impact(ALL_THREE)));

    fireEvent.click(screen.getByTestId("investigation-report-toggle"));
    await flush();

    expect(screen.getByTestId("investigation-report-open")).toBeVisible();
    expect(impactList()).toBeNull();
    expect(screen.getByTestId("investigation-report-impact")).toBeVisible();

    // Folded again, the numbers are back.
    fireEvent.click(screen.getByTestId("investigation-report-toggle"));
    await flush();

    expect(impactLines()).toHaveLength(3);
  });

  test("only beside the report they measured: none while it is being prepared", async () => {
    await renderPanel(completedRun(impact(ALL_THREE)), {
      analysisMarkdown: null,
      isAnalysisPending: true,
    });

    expect(impactList()).toBeNull();
  });
});

describe("its words", () => {
  const english: Translator = createTranslator(() => {
    return undefined;
  }, "en");

  test("each kind of count has its own words, never confused", () => {
    expect(INVESTIGATION_IMPACT_USERS_WORDS).toEqual({
      [InvestigationImpactCounted.Users]: {
        one: "{{count}} user affected",
        other: "{{count}} users affected",
      },
      [InvestigationImpactCounted.Sessions]: {
        one: "{{count}} session affected",
        other: "{{count}} sessions affected",
      },
      [InvestigationImpactCounted.Requests]: {
        one: "{{count}} request affected",
        other: "{{count}} requests affected",
      },
    });
    expect(INVESTIGATION_IMPACT_SERVICES_WORDS.other).toBe(
      "{{count}} services affected",
    );
    expect(INVESTIGATION_IMPACT_SLOS_WORDS.other).toBe(
      "{{affected}} of {{count}} SLOs affected",
    );
    expect(INVESTIGATION_IMPACT_LIST_LABEL).toBe("Impact");
  });

  test("nothing measured, no line", () => {
    expect(getInvestigationImpactLines({}, english)).toEqual([]);
  });
});

/*
 * IN THE READER'S LANGUAGE. Every line is the reader's language's own,
 * its counts in its own digits. Last in the file: it leaves i18next set up,
 * in English.
 */
describe("in the reader's language", () => {
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
  const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
  const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;
  const LATIN_DIGIT: RegExp = /[0-9]/;

  function readLocale(language: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }

  const TEMPLATES: Array<PluralTemplate> = [
    ...Object.values(INVESTIGATION_IMPACT_USERS_WORDS),
    INVESTIGATION_IMPACT_SERVICES_WORDS,
    INVESTIGATION_IMPACT_SLOS_WORDS,
  ];

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
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test.each(LANGUAGES.slice(1))(
    "%s words every line its own way, keeping every placeholder",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);
      const english: Record<string, string> = readLocale("en");

      for (const template of TEMPLATES) {
        for (const key of [template.other, `${template.other}_one`]) {
          const value: string | undefined = locale[key];

          expect({ language, key, isText: typeof value === "string" }).toEqual({
            language,
            key,
            isText: true,
          });
          expect((value!.match(PLACEHOLDER) || []).sort()).toEqual(
            (english[key]!.match(PLACEHOLDER) || []).sort(),
          );
        }

        // The general form is the language's own, never the English.
        expect({ language, value: locale[template.other] }).not.toEqual({
          language,
          value: english[template.other],
        });
      }
    },
  );

  test("German: its own words, its own thousands separator", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });
    await renderPanel(completedRun(impact(ALL_THREE)));

    expect(impactLines()).toEqual([
      { aspect: "Users", text: "1.240 Anfragen betroffen" },
      { aspect: "Services", text: "2 Dienste betroffen" },
      { aspect: "Slos", text: "1 von 2 SLOs betroffen" },
    ]);
    expect(impactList()).toHaveAttribute("aria-label", "Auswirkungen");
  });

  test("Persian: its own words, every count in Persian digits", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("fa");
    });
    await renderPanel(completedRun(impact(ALL_THREE)));

    const lines: Array<{ aspect: string | null; text: string }> = impactLines();

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.text).toMatch(PERSIAN_DIGIT);
      expect(line.text).not.toMatch(LATIN_DIGIT);
      expect(line.text).not.toMatch(/affected/);
    }
    expect(lines[0]!.text).toBe(
      readLocale("fa")["{{count}} requests affected"]!.replace(
        "{{count}}",
        "۱٬۲۴۰",
      ),
    );
    expect(
      within(impactList()!).getAllByTestId("investigation-folded-impact-line"),
    ).toHaveLength(3);
  });
});
