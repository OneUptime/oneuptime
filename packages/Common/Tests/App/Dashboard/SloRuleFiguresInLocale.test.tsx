/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import { ComponentProps as ConfirmModalProps } from "../../../UI/Components/Modal/ConfirmModal";

/*
 * A BURN RATE RULE'S FIGURES IN THE READER'S LANGUAGE (#6924), from the
 * Dashboard's shipped locale files:
 *
 *   - the Burn Rate Rules page's Windows column, "60m / 5m" and "Suppress
 *     60m after resolve";
 *   - the Add recommended rules dialog, which lists each rule with its
 *     threshold, what it fires on ("about 2% of the error budget burns in
 *     1h"), its windows and its suppression;
 *   - the SLO list's bulk Add recommended rules confirmation, which says the
 *     same of each rule it would add;
 *   - the Overview's Burn Rate tile, whose note names the burn rate that
 *     spends the budget exactly over the window, "1×".
 *
 * A Persian page wrote all of these with Latin digits beside a Persian
 * "۱۴٫۴×", a German one "4320 Min." with no thousands separator and "2%"
 * with the English percent, and the tile's "1×" sat in the words, where a
 * Persian sentence read right to left drew it "×۱". Each figure is now
 * written the reader's way - and an English reader reads every line word
 * for word as before.
 *
 * A share is one value with its sign, set apart from the sentence: with
 * the sign written into a Persian sentence after a bare figure, the line
 * drew it on the figure's left, "٪۲", a few lines under the Overview's
 * "99.9%".
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

// A Latin digit: none is left on a Persian page.
const LATIN_DIGIT: RegExp = /[0-9]/;

// The marks a sentence sets its values apart with, and those of a burn rate.
const BIDI_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x200e, 0x200f)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`,
  "g",
);

function withoutMarks(text: string): string {
  return text.replace(BIDI_MARKS, "");
}

// German sets its percent sign apart with a no-break space: "2 %".
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

/*
 * Whether `piece` of a sentence on a right-to-left page is drawn as it is
 * written (Tests/Helpers/BidiLayout): a share's figure, then its sign on
 * its right, as the Overview and the Settings page draw "99.9%".
 */
function isDrawnAsWrittenIn(sentence: string, piece: string): boolean {
  const from: number = sentence.indexOf(piece);

  expect({ piece, found: from >= 0 }).toEqual({ piece, found: true });

  return isDrawnAsWritten(drawLine(sentence, "rtl"), from, from + piece.length);
}

const mockPost: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => Record<string, unknown> = request.modelType;

        return Promise.resolve(
          Object.assign(new Model(), {
            _id: "11111111-1111-4111-8111-111111111111",
            isEnabled: true,
          }),
        );
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "22222222-2222-4222-8222-222222222222" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return (error as Error).message;
      },
    },
  };
});

let mockRows: Array<ServiceLevelObjectiveBurnRateRule> = [];

/*
 * The rules table: a row per rule, each cell drawn by the page's own column
 * (getElement), as BaseModelTable draws an Element column.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (
      props: ModelTableProps<ServiceLevelObjectiveBurnRateRule>,
    ): React.ReactElement => {
      React.useEffect(() => {
        props.onFetchSuccess?.([...mockRows], mockRows.length);
      }, [props.refreshToggle]);

      return (
        <table data-testid={props.id}>
          <tbody>
            {mockRows.map(
              (row: ServiceLevelObjectiveBurnRateRule, index: number) => {
                return (
                  <tr key={index} data-testid="rule-row">
                    {props.columns.map(
                      (
                        column: ModelTableProps<ServiceLevelObjectiveBurnRateRule>["columns"][number],
                        columnIndex: number,
                      ) => {
                        return (
                          <td key={columnIndex} data-column={column.title}>
                            {column.getElement ? column.getElement(row) : null}
                          </td>
                        );
                      },
                    )}
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloNoticeBanner",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: ConfirmModalProps): React.ReactElement => {
      return (
        <div role="dialog" aria-label={props.title}>
          {props.children}
        </div>
      );
    },
  };
});

import SloBurnRateRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules";
import SloRecommendedBurnRateRulesModal from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloRecommendedBurnRateRulesModal";
import SloBulkRecommendedRulesDetails, {
  SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBulkRecommendedRulesDetails";
import SloKpiStrip from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloKpiStrip";
import {
  BURN_RATE_RULE_FIRES_WHEN_TEMPLATE,
  BURN_RATE_RULE_SUPPRESSION_TEMPLATE,
  BURN_RATE_RULE_WINDOWS_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleLines";
import RecommendedBurnRateRulesApi from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/RecommendedBurnRateRulesApi";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Route from "../../../Types/API/Route";
import { getNumberLocale } from "../../../Types/DateLanguage";
import { getInlineSeparator } from "../../../Types/Translator";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  SloBulkRecommendedRulesResult,
  SloBulkRecommendedRulesStatus,
} from "../../../Utils/Slo/SloBulkRecommendedBurnRateRules";
import { formatDurationCompactInLanguage } from "../../../Utils/Slo/SloDuration";
import {
  SloRecommendedBurnRateRule,
  SloRecommendedBurnRateRuleToAdd,
  getSloRecommendedBurnRateRules,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";
import {
  formatSloBurnRate,
  formatSloPercent,
} from "../../../Utils/Slo/SloWidgetFormat";
import { drawLine, isDrawnAsWritten } from "../../Helpers/BidiLayout";
import { isolated } from "../../Helpers/IsolateMarks";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const NOW: Date = new Date("2026-09-15T12:00:00.000Z");

const WINDOWS_COLUMN: string = "Windows (Long / Short)";
const THRESHOLD_COLUMN: string = "Threshold";

// A number as the language's own Intl.NumberFormat writes it.
function numberIn(language: string, value: number): string {
  return new Intl.NumberFormat(getNumberLocale(language), {
    maximumFractionDigits: 2,
  }).format(value);
}

// The reader's translator, as the page's components get it.
function reader(): Translator {
  return getGlobalTranslator();
}

function ruleRow(data: {
  name: string;
  burnRateThreshold: number;
  longWindowInMinutes?: number | undefined;
  shortWindowInMinutes?: number | undefined;
  refireSuppressionMinutes?: number | undefined;
}): ServiceLevelObjectiveBurnRateRule {
  const row: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  row._id = ObjectID.generate().toString();
  Object.assign(row, data);
  return row;
}

// Fast burn and Slow leak on a 30-day SLO, as the rules table lists them.
function fastBurnAndSlowLeak(): Array<ServiceLevelObjectiveBurnRateRule> {
  return [
    ruleRow({
      name: "Fast burn",
      burnRateThreshold: 14.4,
      longWindowInMinutes: 60,
      shortWindowInMinutes: 5,
    }),
    ruleRow({
      name: "Slow leak",
      burnRateThreshold: 1,
      longWindowInMinutes: 4320,
      shortWindowInMinutes: 360,
      refireSuppressionMinutes: 1440,
    }),
  ];
}

function recommendedToAdd(
  windowDays: number,
): Array<SloRecommendedBurnRateRuleToAdd> {
  return getSloRecommendedBurnRateRules({ windowDays: windowDays }).map(
    (rule: SloRecommendedBurnRateRule): SloRecommendedBurnRateRuleToAdd => {
      return { ...rule, alertSeverityName: "Low" };
    },
  );
}

async function renderRulesPage(): Promise<void> {
  render(
    <MemoryRouter>
      <SloBurnRateRules
        pageRoute={new Route("/dashboard/slos")}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("slo-burn-rate-rules-table")).toBeInTheDocument();
  });

  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

// The Windows cell of each row, its two lines.
function windowsCells(): Array<Array<string>> {
  return screen
    .getAllByTestId("rule-row")
    .map((row: HTMLElement): Array<string> => {
      const cell: HTMLElement = row.querySelector(
        `[data-column="${WINDOWS_COLUMN}"]`,
      ) as HTMLElement;

      return Array.from(cell.querySelectorAll("div > div")).map(
        (line: Element): string => {
          return line.textContent || "";
        },
      );
    });
}

function thresholdCells(): Array<string> {
  return screen.getAllByTestId("rule-row").map((row: HTMLElement): string => {
    return (
      row.querySelector(`[data-column="${THRESHOLD_COLUMN}"]`)?.textContent ||
      ""
    );
  });
}

function renderModal(rules: Array<SloRecommendedBurnRateRuleToAdd>): void {
  render(
    <SloRecommendedBurnRateRulesModal
      rules={rules}
      isLoading={false}
      error=""
      onSubmit={() => {}}
      onClose={() => {}}
    />,
  );
}

// Each rule of the dialog, its lines in order.
function modalRules(): Array<Array<string>> {
  return screen
    .getAllByTestId("slo-recommended-burn-rate-rule")
    .map((item: HTMLElement): Array<string> => {
      const firstLine: Array<string> = Array.from(
        item.querySelectorAll(":scope > div:first-child > span"),
      ).map((span: Element): string => {
        return span.textContent || "";
      });
      const others: Array<string> = Array.from(
        item.querySelectorAll(":scope > div:not(:first-child)"),
      ).map((line: Element): string => {
        return line.textContent || "";
      });

      return [...firstLine, ...others];
    });
}

function sloNamed(id: string, name: string): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = id;
  slo.name = name;
  return slo;
}

const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SEARCH_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function renderBulkDetails(): Promise<void> {
  // Checkout is on a 30-day window, Search on a 7-day one.
  const results: Array<SloBulkRecommendedRulesResult> = [
    {
      serviceLevelObjectiveId: CHECKOUT_ID,
      status: SloBulkRecommendedRulesStatus.Missing,
      rules: [recommendedToAdd(30)[0]!, recommendedToAdd(30)[2]!],
      message: null,
    },
    {
      serviceLevelObjectiveId: SEARCH_ID,
      status: SloBulkRecommendedRulesStatus.Missing,
      rules: [recommendedToAdd(7)[2]!],
      message: null,
    },
  ];

  jest
    .spyOn(RecommendedBurnRateRulesApi, "getMissingForMany")
    .mockResolvedValue(results);

  render(
    <SloBulkRecommendedRulesDetails
      items={[sloNamed(CHECKOUT_ID, "Checkout"), sloNamed(SEARCH_ID, "Search")]}
      controls={{ setIsSubmitHeld: () => {} }}
      onPreview={() => {}}
    />,
  );

  await screen.findByTestId(SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID);
}

// Each variant the confirmation lists: its first line, then its facts.
function bulkVariants(): Array<{ line: string; facts: Array<string> }> {
  return screen
    .getAllByTestId(`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-variant`)
    .map((variant: HTMLElement) => {
      const facts: HTMLElement = variant.querySelector(
        ":scope > div:nth-child(2)",
      ) as HTMLElement;

      return {
        line:
          variant.querySelector(":scope > div:first-child > span")
            ?.textContent || "",
        facts: Array.from(facts.querySelectorAll("span.whitespace-nowrap")).map(
          (fact: Element): string => {
            return fact.textContent || "";
          },
        ),
      };
    });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  mockRows = fastBurnAndSlowLeak();
  mockPost.mockReset();
  // The SLO has every recommended rule: no note above the rows.
  mockPost.mockImplementation(async (): Promise<unknown> => {
    return { data: { rules: [] } };
  });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(SLO_ID);
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/slos"));
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Burn Rate Rules page's Windows column (#6924)", () => {
  test("English: every line word for word as before, with no thousands separator", async () => {
    await renderRulesPage();

    expect(windowsCells()).toEqual([
      ["60m / 5m", "Suppress 60m after resolve"],
      ["4320m / 360m", "Suppress 1440m after resolve"],
    ]);
  });

  test("Persian: the windows and the suppression in Persian digits, as the threshold beside them", async () => {
    await i18next.changeLanguage("fa");
    await renderRulesPage();

    expect(windowsCells()).toEqual([
      [
        worded(FA, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
          long: "۶۰",
          short: "۵",
        }),
        worded(FA, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, { minutes: "۶۰" }),
      ],
      [
        worded(FA, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
          long: numberIn("fa", 4320),
          short: "۳۶۰",
        }),
        worded(FA, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, {
          minutes: numberIn("fa", 1440),
        }),
      ],
    ]);

    // Not one Latin digit in the column, nor in the threshold beside it.
    for (const lines of windowsCells()) {
      for (const line of lines) {
        expect({ line, latinDigit: LATIN_DIGIT.test(line) }).toEqual({
          line,
          latinDigit: false,
        });
      }
    }

    expect(thresholdCells()).toEqual([
      formatSloBurnRate(14.4, reader()),
      formatSloBurnRate(1, reader()),
    ]);
    expect(thresholdCells().join("")).not.toMatch(LATIN_DIGIT);
  });

  test("German: a thousands separator and the German minute, never the English m", async () => {
    await i18next.changeLanguage("de");
    await renderRulesPage();

    expect(windowsCells()).toEqual([
      [
        worded(DE, BURN_RATE_RULE_WINDOWS_TEMPLATE, { long: "60", short: "5" }),
        worded(DE, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, { minutes: "60" }),
      ],
      [
        worded(DE, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
          long: "4.320",
          short: "360",
        }),
        worded(DE, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, { minutes: "1.440" }),
      ],
    ]);
    expect(windowsCells().flat().join("\n")).not.toMatch(/\dm\b/);
  });

  test("Arabic: the figures as Arabic's own number format writes them", async () => {
    await i18next.changeLanguage("ar");
    await renderRulesPage();

    expect(windowsCells()[1]).toEqual([
      worded(AR, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
        long: numberIn("ar", 4320),
        short: numberIn("ar", 360),
      }),
      worded(AR, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, {
        minutes: numberIn("ar", 1440),
      }),
    ]);
  });

  test("a rule with no windows reads 0, and its suppression the long window it falls back to", async () => {
    mockRows = [
      ruleRow({ name: "Unset", burnRateThreshold: 2 }),
      ruleRow({
        name: "No suppression",
        burnRateThreshold: 6,
        longWindowInMinutes: 360,
        shortWindowInMinutes: 30,
      }),
    ];

    await renderRulesPage();

    expect(windowsCells()).toEqual([
      ["0m / 0m", "Suppress 0m after resolve"],
      ["360m / 30m", "Suppress 360m after resolve"],
    ]);

    cleanup();
    await i18next.changeLanguage("fa");
    await renderRulesPage();

    expect(windowsCells()).toEqual([
      [
        worded(FA, BURN_RATE_RULE_WINDOWS_TEMPLATE, { long: "۰", short: "۰" }),
        worded(FA, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, { minutes: "۰" }),
      ],
      [
        worded(FA, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
          long: "۳۶۰",
          short: "۳۰",
        }),
        worded(FA, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, { minutes: "۳۶۰" }),
      ],
    ]);
  });
});

describe("the Add recommended rules dialog (#6924)", () => {
  test("English: each rule's lines word for word as before", () => {
    renderModal(recommendedToAdd(30));

    expect(modalRules()).toEqual([
      [
        "Fast burn",
        "14.4×",
        "Fires when about 2% of the error budget burns in 1h",
        "60m / 5m",
        "Suppress 60m after resolve",
        "Alert: Low",
      ],
      [
        "Slow burn",
        "6×",
        "Fires when about 5% of the error budget burns in 6h",
        "360m / 30m",
        "Suppress 360m after resolve",
        "Alert: Low",
      ],
      [
        "Slow leak",
        "1×",
        "Fires when about 10% of the error budget burns in 3d",
        "4320m / 360m",
        "Suppress 1440m after resolve",
        "Alert: Low",
      ],
    ]);
  });

  test("Persian: every figure of every rule in Persian digits, the share and the window too", async () => {
    await i18next.changeLanguage("fa");
    renderModal(recommendedToAdd(30));

    const rules: Array<Array<string>> = modalRules();

    expect(rules[0]).toEqual([
      "Fast burn",
      formatSloBurnRate(14.4, reader()),
      worded(FA, BURN_RATE_RULE_FIRES_WHEN_TEMPLATE, {
        percent: isolated("۲٪"),
        duration: isolated(formatDurationCompactInLanguage(3600, "fa")),
      }),
      worded(FA, BURN_RATE_RULE_WINDOWS_TEMPLATE, { long: "۶۰", short: "۵" }),
      worded(FA, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, { minutes: "۶۰" }),
      expect.any(String),
    ]);
    expect(rules[2]?.slice(2, 5)).toEqual([
      worded(FA, BURN_RATE_RULE_FIRES_WHEN_TEMPLATE, {
        percent: isolated("۱۰٪"),
        duration: isolated(
          formatDurationCompactInLanguage(3 * 24 * 3600, "fa"),
        ),
      }),
      worded(FA, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
        long: numberIn("fa", 4320),
        short: "۳۶۰",
      }),
      worded(FA, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, {
        minutes: numberIn("fa", 1440),
      }),
    ]);

    // The rules' names and severity are data; every figure is Persian.
    expect(
      screen.getByTestId("slo-recommended-burn-rate-rules").textContent,
    ).not.toMatch(LATIN_DIGIT);
  });

  test("German: a decimal comma, the German percent and the German units", async () => {
    await i18next.changeLanguage("de");
    renderModal(recommendedToAdd(30));

    const rules: Array<Array<string>> = modalRules();

    expect(rules[0]?.slice(1, 5)).toEqual([
      "14,4×",
      worded(DE, BURN_RATE_RULE_FIRES_WHEN_TEMPLATE, {
        percent: `2${NO_BREAK_SPACE}%`,
        duration: formatDurationCompactInLanguage(3600, "de"),
      }),
      worded(DE, BURN_RATE_RULE_WINDOWS_TEMPLATE, { long: "60", short: "5" }),
      worded(DE, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, { minutes: "60" }),
    ]);
    expect(rules[2]?.slice(3, 5)).toEqual([
      worded(DE, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
        long: "4.320",
        short: "360",
      }),
      worded(DE, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, { minutes: "1.440" }),
    ]);
  });

  test("a 7-day SLO's scaled Slow leak: its 16.8 hours, and the suppression it falls back to, the reader's way", async () => {
    /*
     * Slow leak over 16.8 hours on a 7-day window: 1008m / 84m, waiting the
     * long window it falls back to before it fires again.
     */
    renderModal([recommendedToAdd(7)[2]!]);

    expect(modalRules()[0]?.slice(2, 5)).toEqual([
      "Fires when about 10% of the error budget burns in 16h 48m",
      "1008m / 84m",
      "Suppress 1008m after resolve",
    ]);

    cleanup();
    await i18next.changeLanguage("fa");
    renderModal([recommendedToAdd(7)[2]!]);

    expect(modalRules()[0]?.slice(2, 5)).toEqual([
      worded(FA, BURN_RATE_RULE_FIRES_WHEN_TEMPLATE, {
        percent: isolated("۱۰٪"),
        duration: isolated(formatDurationCompactInLanguage(1008 * 60, "fa")),
      }),
      worded(FA, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
        long: numberIn("fa", 1008),
        short: "۸۴",
      }),
      worded(FA, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, {
        minutes: numberIn("fa", 1008),
      }),
    ]);
  });

  test("Persian and Arabic: each share drawn with its sign on its right, as the Overview draws one", async () => {
    for (const language of ["fa", "ar"]) {
      cleanup();
      await i18next.changeLanguage(language);
      renderModal(recommendedToAdd(30));

      const lines: Array<string> = modalRules().map(
        (rule: Array<string>): string => {
          return rule[2] as string;
        },
      );

      [2, 5, 10].forEach((share: number, index: number) => {
        const written: string = formatSloPercent(share, 2, reader()) as string;

        expect({
          language,
          written,
          drawnAsWritten: isDrawnAsWrittenIn(lines[index] as string, written),
        }).toEqual({ language, written, drawnAsWritten: true });
      });
    }

    // The line as it was filled before, a bare figure with the sign after it: drawn "٪۲".
    expect(
      isDrawnAsWrittenIn(
        worded(FA, BURN_RATE_RULE_FIRES_WHEN_TEMPLATE, {
          percent: "۲٪",
          duration: formatDurationCompactInLanguage(3600, "fa"),
        }),
        "۲٪",
      ),
    ).toBe(false);
  });
});

describe("the SLO list's bulk Add recommended rules confirmation (#6924)", () => {
  test("English: each rule's threshold, share, windows and suppression word for word as before", async () => {
    await renderBulkDetails();

    const variants: Array<{ line: string; facts: Array<string> }> =
      bulkVariants();

    expect(
      variants.map((variant: { line: string; facts: Array<string> }) => {
        return variant.facts;
      }),
    ).toEqual([
      ["60m / 5m", "Suppress 60m after resolve", "Alert: Low"],
      ["4320m / 360m", "Suppress 1440m after resolve", "Alert: Low"],
      ["1008m / 84m", "Suppress 1008m after resolve", "Alert: Low"],
    ]);
    expect(variants[0]?.line).toContain("14.4×");
    expect(variants[0]?.line).toContain(
      "Fires when about 2% of the error budget burns in 1h",
    );
  });

  test("Persian: not one Latin digit in what it would add", async () => {
    await i18next.changeLanguage("fa");
    await renderBulkDetails();

    const variants: Array<{ line: string; facts: Array<string> }> =
      bulkVariants();

    expect(variants[1]?.facts.slice(0, 2)).toEqual([
      worded(FA, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
        long: numberIn("fa", 4320),
        short: "۳۶۰",
      }),
      worded(FA, BURN_RATE_RULE_SUPPRESSION_TEMPLATE, {
        minutes: numberIn("fa", 1440),
      }),
    ]);
    // The threshold as the rules table writes it, its "×" kept after it.
    expect(variants[0]?.line).toContain(
      formatSloBurnRate(14.4, reader()) as string,
    );
    expect(variants[0]?.line).toContain(
      worded(FA, BURN_RATE_RULE_FIRES_WHEN_TEMPLATE, {
        percent: isolated("۲٪"),
        duration: isolated(formatDurationCompactInLanguage(3600, "fa")),
      }),
    );
    expect(isDrawnAsWrittenIn(variants[0]?.line as string, "۲٪")).toBe(true);

    for (const variant of variants) {
      for (const text of [variant.line, ...variant.facts]) {
        expect({ text, latinDigit: LATIN_DIGIT.test(text) }).toEqual({
          text,
          latinDigit: false,
        });
      }
    }
  });

  test("German: the threshold with a decimal comma, from the burn rate formatter", async () => {
    await i18next.changeLanguage("de");
    await renderBulkDetails();

    const variants: Array<{ line: string; facts: Array<string> }> =
      bulkVariants();

    expect(variants[0]?.line).toContain("14,4×");
    expect(variants[0]?.line).not.toContain("14.4");
    expect(variants[1]?.facts[0]).toBe(
      worded(DE, BURN_RATE_RULE_WINDOWS_TEMPLATE, {
        long: "4.320",
        short: "360",
      }),
    );
  });
});

describe("the Overview's Burn Rate tile note (#6924)", () => {
  const NOTE_KEY: string =
    "Over the last {{window}} · {{rate}} spends the budget exactly over the window";

  function renderBurningStrip(): string {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    Object.assign(slo, {
      targetPercentage: 99.9,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      timezone: "UTC",
      atRiskThresholdPercentage: 25,
      multiMonitorMode: SloMultiMonitorMode.AnyDown,
      sliType: SliType.MonitorUptime,
      downtimeMonitorStatuses: [],
      currentSliPercentage: 99.812,
      errorBudgetRemainingPercentage: 15,
      errorBudgetRemainingSeconds: 389,
      errorBudgetTotalSeconds: 2592,
      currentBurnRate: 14.4,
      sloStatus: SloStatus.AtRisk,
      lastEvaluatedAt: NOW,
    });

    render(
      <SloKpiStrip slo={slo} lowestEnabledBurnRateThreshold={2} now={NOW} />,
    );

    return document.getElementById("slo-kpi-burn-rate")?.textContent || "";
  }

  test("English: the note word for word as before", () => {
    expect(renderBurningStrip()).toContain(
      "Over the last 1h · 1× spends the budget exactly over the window",
    );
  });

  test("Persian: the 1× is a Persian burn rate, its × kept after its figure", async () => {
    await i18next.changeLanguage("fa");

    const tile: string = renderBurningStrip();
    const rate: string = formatSloBurnRate(1, reader()) as string;

    // The burn rate formatter's own: Persian one, then its marked ×.
    expect(withoutMarks(rate)).toBe("۱×");
    expect(rate).not.toBe("۱×");
    expect(tile).toContain(rate);
    // Its words, punctuated with Persian's own separator.
    expect(withoutMarks(tile)).toContain(
      worded(FA, NOTE_KEY, {
        window: formatDurationCompactInLanguage(3600, "fa"),
        rate: "۱×",
      })
        .split(" · ")
        .join(getInlineSeparator("fa")),
    );
    // No Latin "1×" left in the words.
    expect(tile).not.toContain("1×");
    expect(tile).not.toMatch(LATIN_DIGIT);
  });

  test("German: the note worded in German around the same 1×", async () => {
    await i18next.changeLanguage("de");

    expect(renderBurningStrip()).toContain(
      worded(DE, NOTE_KEY, {
        window: formatDurationCompactInLanguage(3600, "de"),
        rate: "1×",
      }),
    );
  });

  test("Arabic: the rate is the burn rate formatter's, as the tile's own figure", async () => {
    await i18next.changeLanguage("ar");

    const tile: string = renderBurningStrip();

    expect(tile).toContain(formatSloBurnRate(1, reader()) as string);
    expect(tile).toContain(formatSloBurnRate(14.4, reader()) as string);
  });
});

describe("what the page and the dialogs read from", () => {
  test("every line has its own words in German, Persian and Arabic", () => {
    for (const locale of [DE, FA, AR]) {
      for (const key of [
        BURN_RATE_RULE_WINDOWS_TEMPLATE,
        BURN_RATE_RULE_SUPPRESSION_TEMPLATE,
        BURN_RATE_RULE_FIRES_WHEN_TEMPLATE,
        "Over the last {{window}} · {{rate}} spends the budget exactly over the window",
      ]) {
        expect(worded(locale, key)).toBeTruthy();
      }
    }
  });
});
