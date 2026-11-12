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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";

/*
 * THE SLO OVERVIEW'S CARDS, THE TWO-FACTOR STATUS AND A WORKSPACE'S TEST
 * BUTTON IN THE READER'S LANGUAGE - from the Dashboard's shipped locale
 * files (#6658).
 *
 * A German SLO overview used to say "Rolling 30 days", "43m 12s of downtime
 * allowed per rolling 30 days" and "2 burn rate rules are ready to alert"
 * between German labels, and an Arabic one counted its days the English
 * way; the two-factor card said "Enabled" in every language, and the Slack
 * and Microsoft Teams rows told a screen reader "Send test notification to
 * #alerts" in English. Each is now one sentence looked up whole, counted the
 * way the reader's language counts - and still the English word for word
 * for an English reader.
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

let mockUser: Record<string, unknown> | null = null;
let mockPostResult: unknown = null;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => Record<string, unknown>;
      }): Promise<unknown> => {
        if (!mockUser) {
          return Promise.resolve(null);
        }
        const Model: new () => Record<string, unknown> = request.modelType;
        return Promise.resolve(Object.assign(new Model(), mockUser));
      },
      updateById: (): Promise<unknown> => {
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-under-test" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return mockPostResult instanceof Error
          ? Promise.reject(mockPostResult)
          : Promise.resolve(mockPostResult);
      },
      getFriendlyErrorMessage: (error: unknown): string => {
        return (error as Error).message;
      },
      getFriendlyMessage: (error: unknown): string => {
        return (error as Error).message;
      },
    },
  };
});

import SloBurnRateRulesSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBurnRateRulesSummaryCard";
import SloConfigurationSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloConfigurationSummaryCard";
import SloKpiStrip from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloKpiStrip";
import SloOverviewEmptyState from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewEmptyState";
import SloOverviewGettingStartedCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewGettingStartedCard";
import TwoFactorStatus from "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/TwoFactorStatus";
import SendTestNotificationButton from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/SendTestNotificationButton";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { getNumberLocale } from "../../../Types/DateLanguage";
import UserUtil from "../../../UI/Utils/User";
import { formatDurationCompactInLanguage } from "../../../Utils/Slo/SloDuration";

// A value in a right-to-left sentence, in the isolate that keeps its place.
function setApart(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

/*
 * German writes a decimal comma and sets its percent sign apart with a
 * no-break space (U+00A0): "99,9 %" (#6695).
 */
const NO_BREAK_SPACE: string = "\u00A0";

function germanPercent(figure: string): string {
  return `${figure}${NO_BREAK_SPACE}%`;
}

/*
 * A percentage as the language's own Intl.NumberFormat writes it: Latin
 * digits in Arabic (getNumberLocale), with the marks its pattern holds.
 */
function percentIn(language: string, value: number): string {
  return new Intl.NumberFormat(getNumberLocale(language), {
    style: "percent",
    maximumFractionDigits: 3,
  }).format(value / 100);
}

// A figure with an English decimal point: "99.9", "14.4".
const DECIMAL_POINT: RegExp = /[0-9]\.[0-9]/;

// A tile's text with its label taken off and its isolates' marks left in.
function tileText(id: string): string {
  const tile: HTMLElement | null = document.getElementById(id);

  if (!tile) {
    throw new Error(`No KPI tile with id ${id}`);
  }

  return tile.textContent || "";
}

// The Latin words in a text, past the names every language keeps.
function latinWordsIn(text: string, names: Array<string>): Array<string> {
  return (text.match(/[A-Za-z]+/g) || []).filter((word: string): boolean => {
    return !names.includes(word);
  });
}

const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");
const NOW: Date = new Date("2026-09-15T12:00:00.000Z");

function buildSlo(
  overrides: Partial<Record<keyof ServiceLevelObjective, unknown>> = {},
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.timezone = "UTC";
  slo.atRiskThresholdPercentage = 25;
  slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
  slo.sliType = SliType.MonitorUptime;
  slo.downtimeMonitorStatuses = [];
  Object.assign(slo, overrides);
  return slo;
}

let ruleCounter: number = 0;

function buildRule(
  overrides: Partial<Record<keyof ServiceLevelObjectiveBurnRateRule, unknown>>,
): ServiceLevelObjectiveBurnRateRule {
  ruleCounter += 1;
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = `5f8b7c1e2d3a4b5c6d7e${(9000 + ruleCounter).toString()}`;
  rule.isEnabled = true;
  rule.shouldCreateAlert = false;
  rule.shouldCreateIncident = false;
  Object.assign(rule, overrides);
  return rule;
}

function renderInRouter(element: React.ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
  mockUser = null;
  mockPostResult = new HTTPResponse<JSONObject>(200, {}, {});
  jest
    .spyOn(UserUtil, "getUserId")
    .mockReturnValue(new ObjectID("33333333-3333-4333-8333-333333333333"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the SLO overview's configuration card in German and Arabic", () => {
  test("German: the window, the downtime allowed, the at-risk line and the indicator", () => {
    renderInRouter(
      <SloConfigurationSummaryCard sloId={SLO_ID} slo={buildSlo()} now={NOW} />,
    );

    expect(screen.getByTestId("slo-configuration-window")).toHaveTextContent(
      worded(DE, "Rolling {{count}} days", { count: "30" }),
    );
    expect(
      screen.getByTestId("slo-configuration-at-risk").textContent,
    ).toContain(
      worded(DE, "When {{percent}} or less of the error budget is left", {
        percent: germanPercent("25"),
      }),
    );
    // The objective's figure too: "99,9 % Verfügbarkeit", never "99.9%".
    expect(
      screen.getByTestId("slo-configuration-objective").textContent,
    ).toContain(
      worded(DE, "{{percent}} uptime", { percent: germanPercent("99,9") }),
    );
    expect(
      screen.getByTestId("slo-configuration-summary").textContent,
    ).not.toMatch(DECIMAL_POINT);
    expect(
      screen.getByTestId("slo-configuration-downtime-statuses"),
    ).toHaveTextContent(worded(DE, "Every non-operational status"));
    expect(
      screen.getByTestId("slo-configuration-multi-monitor-mode"),
    ).toHaveTextContent(worded(DE, "Down when any monitor is down"));
    expect(screen.getByTestId("slo-configuration-indicator")).toHaveTextContent(
      worded(DE, "Monitor uptime"),
    );
    expect(screen.getByTestId("slo-configuration-indicator")).toHaveTextContent(
      worded(DE, "Evaluated every {{count}} minutes.", { count: "5" }),
    );

    const objective: HTMLElement = screen.getByTestId(
      "slo-configuration-objective",
    );

    expect(objective).toHaveTextContent(
      /Ausfallzeit erlaubt pro rollierenden 30 Tagen/,
    );

    // None of the English it used to show is left.
    for (const english of [
      "Rolling 30 days",
      "of downtime allowed",
      "or less of the error budget is left",
      "Every non-operational status",
      "Monitor uptime",
      "Evaluated every 5 minutes.",
      "43m 12s",
    ]) {
      expect(document.body.textContent).not.toContain(english);
    }
  });

  test("Arabic: a calendar month, and days counted with a label", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    renderInRouter(
      <SloConfigurationSummaryCard
        sloId={SLO_ID}
        slo={buildSlo({
          windowType: SloWindowType.CalendarMonth,
          timezone: "Asia/Riyadh",
        })}
        now={NOW}
      />,
    );

    expect(screen.getByTestId("slo-configuration-window")).toHaveTextContent(
      worded(AR, "Calendar month ({{timezone}})", { timezone: "Asia/Riyadh" }),
    );
    expect(screen.getByTestId("slo-configuration-objective")).toHaveTextContent(
      /^.*وقت التوقف المسموح به هذا الشهر التقويمي: .+$/,
    );
    cleanup();

    renderInRouter(
      <SloConfigurationSummaryCard sloId={SLO_ID} slo={buildSlo()} now={NOW} />,
    );
    expect(screen.getByTestId("slo-configuration-window")).toHaveTextContent(
      "نافذة متحركة (الأيام: 30)",
    );
  });

  test("English reads word for word as before", async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });

    renderInRouter(
      <SloConfigurationSummaryCard sloId={SLO_ID} slo={buildSlo()} now={NOW} />,
    );

    expect(screen.getByTestId("slo-configuration-window")).toHaveTextContent(
      "Rolling 30 days",
    );
    expect(
      within(screen.getByTestId("slo-configuration-objective")).getByText(
        "43m 12s of downtime allowed per rolling 30 days",
      ),
    ).toBeInTheDocument();
  });
});

describe("the SLO overview's burn rate rules card in German", () => {
  const rules: Array<ServiceLevelObjectiveBurnRateRule> = [
    buildRule({
      name: "Fast burn",
      burnRateThreshold: 14.4,
      longWindowInMinutes: 60,
      shortWindowInMinutes: 5,
      shouldCreateIncident: true,
    }),
    buildRule({
      name: "Paused rule",
      burnRateThreshold: 1,
      isEnabled: false,
    }),
  ];

  test("each rule's threshold is one German sentence, and the disabled rule is counted in German", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={rules}
        currentBurnRate={2}
        error=""
      />,
    );

    const row: HTMLElement = screen.getByTestId("slo-burn-rule-row");

    expect(row.textContent).toContain(
      worded(
        DE,
        "At {{rate}} or faster over {{longWindow}} and {{shortWindow}}",
        {
          rate: "14,4×",
          longWindow: formatDurationCompactInLanguage(3600, "de"),
          shortWindow: formatDurationCompactInLanguage(300, "de"),
        },
      ),
    );
    // The rate in German figures, never with the English point.
    expect(row.textContent).not.toMatch(DECIMAL_POINT);
    // The windows are German durations, never the English "1h" and "5m".
    expect(formatDurationCompactInLanguage(3600, "de")).not.toBe("1h");
    expect(row.textContent).not.toContain("or faster");
    expect(row.textContent).not.toContain(" over ");
    expect(document.body.textContent).toContain(
      worded(DE, "{{count}} disabled rules are not shown._one", {
        count: "1",
      }),
    );
    expect(document.body.textContent).not.toContain("disabled rule is not");
  });

  test("the threshold sentence runs under the name and the At threshold badge, never beside the badge", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={rules}
        currentBurnRate={20}
        error=""
      />,
    );

    const row: HTMLElement = screen.getByTestId("slo-burn-rule-row");
    const threshold: HTMLElement = within(row).getByTestId(
      "slo-burn-rule-threshold",
    );
    const badge: HTMLElement = within(row).getByText(
      worded(DE, "At threshold"),
    );

    // The name and the badge share the row's first line ...
    const firstLine: Element = row.children[0]!;
    expect(firstLine).toHaveClass("flex");
    expect(firstLine).toHaveTextContent("Fast burn");
    expect(firstLine.contains(badge)).toBe(true);

    /*
     * ... and the German sentence, longer than the English, has a line of
     * its own at the card's whole width.
     */
    expect(firstLine.contains(threshold)).toBe(false);
    expect(threshold.parentElement).toBe(row);
    expect(threshold.previousElementSibling).toBe(firstLine);
    expect(threshold).toHaveTextContent(
      worded(
        DE,
        "At {{rate}} or faster over {{longWindow}} and {{shortWindow}}",
        {
          rate: "14,4×",
          longWindow: formatDurationCompactInLanguage(3600, "de"),
          shortWindow: formatDurationCompactInLanguage(300, "de"),
        },
      ),
    );
  });

  test("with every rule disabled it warns, in German, that nothing alerts", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={[rules[1]!]}
        currentBurnRate={null}
        error=""
      />,
    );

    expect(screen.getByTestId("slo-burn-rules-empty")).toHaveTextContent(
      worded(
        DE,
        "This SLO has {{count}} disabled rules, so nothing alerts when it burns its error budget too fast._one",
        { count: "1" },
      ),
    );
  });
});

describe("the SLO overview's KPI strip in German and Arabic", () => {
  const KPI_TILES: Array<string> = [
    "slo-kpi-sli",
    "slo-kpi-budget",
    "slo-kpi-burn-rate",
    "slo-kpi-runway",
  ];

  // The English the strip wrote before it was looked up (#6658).
  const ENGLISH_NOTES: Array<string> = [
    "above the",
    "below the",
    "left of",
    "over budget",
    "allowed",
    "Budget exceeded",
    "Overspent",
    "Sustainable",
    "Outlasts",
    "Until exhausted",
    "burn rate of the last",
    "Over the last",
    "spends the budget",
    "not evaluated",
  ];

  const HEALTHY: Partial<Record<keyof ServiceLevelObjective, unknown>> = {
    currentSliPercentage: 99.95,
    errorBudgetRemainingPercentage: 62.5,
    errorBudgetRemainingSeconds: 1620,
    errorBudgetTotalSeconds: 2592,
    currentBurnRate: 0.5,
    sloStatus: SloStatus.Healthy,
    lastEvaluatedAt: NOW,
  };

  const BURNING: Partial<Record<keyof ServiceLevelObjective, unknown>> = {
    currentSliPercentage: 99.812,
    errorBudgetRemainingPercentage: 15,
    errorBudgetRemainingSeconds: 389,
    errorBudgetTotalSeconds: 2592,
    currentBurnRate: 14.4,
    sloStatus: SloStatus.AtRisk,
    lastEvaluatedAt: NOW,
  };

  const OVERSPENT: Partial<Record<keyof ServiceLevelObjective, unknown>> = {
    currentSliPercentage: 99.5,
    errorBudgetRemainingPercentage: -5,
    errorBudgetRemainingSeconds: -300,
    errorBudgetTotalSeconds: 2592,
    currentBurnRate: 3,
    sloStatus: SloStatus.BudgetExhausted,
    lastEvaluatedAt: NOW,
  };

  function renderStrip(
    overrides: Partial<Record<keyof ServiceLevelObjective, unknown>>,
  ): void {
    render(
      <SloKpiStrip
        slo={buildSlo(overrides)}
        lowestEnabledBurnRateThreshold={2}
        now={NOW}
      />,
    );
  }

  function expectNoEnglishNotes(): void {
    const text: string = KPI_TILES.map(tileText).join("\n");

    expect(
      ENGLISH_NOTES.filter((english: string): boolean => {
        return text.includes(english);
      }),
    ).toEqual([]);
  }

  test("German: a healthy SLO's gap to target, budget left and runway", () => {
    renderStrip(HEALTHY);

    expect(tileText("slo-kpi-sli")).toContain(
      worded(DE, "{{delta}} pp above the {{target}} target", {
        delta: "0,05",
        target: germanPercent("99,9"),
      }),
    );
    expect(tileText("slo-kpi-budget")).toContain(
      worded(DE, "{{remaining}} left of {{total}}", {
        remaining: formatDurationCompactInLanguage(1620, "de"),
        total: formatDurationCompactInLanguage(2592, "de"),
      }),
    );
    expect(tileText("slo-kpi-runway")).toContain(worded(DE, "Sustainable"));
    // German durations, never the English "27m" and "43m 12s".
    expect(tileText("slo-kpi-budget")).not.toContain("27m");
    expect(tileText("slo-kpi-budget")).not.toContain("43m 12s");
    expectNoEnglishNotes();
    // A Latin sentence with Latin values needs no isolate.
    expect(KPI_TILES.map(tileText).join("")).not.toContain(
      FIRST_STRONG_ISOLATE,
    );
  });

  test("German: a burning SLO's runway and the not-yet-evaluated line", () => {
    renderStrip(BURNING);

    expect(tileText("slo-kpi-sli")).toContain(
      worded(DE, "{{delta}} pp below the {{target}} target", {
        delta: "0,088",
        target: germanPercent("99,9"),
      }),
    );
    expect(tileText("slo-kpi-runway")).toContain(
      worded(DE, "Until exhausted, at the burn rate of the last {{window}}", {
        window: formatDurationCompactInLanguage(3600, "de"),
      }),
    );
    expect(tileText("slo-kpi-burn-rate")).toContain(
      // The 1× is a value, written by the burn rate formatter (#6924).
      worded(
        DE,
        "Over the last {{window}} · {{rate}} spends the budget exactly over the window",
        { window: formatDurationCompactInLanguage(3600, "de"), rate: "1×" },
      ),
    );
    expectNoEnglishNotes();

    cleanup();
    renderStrip({});

    expect(tileText("slo-kpi-sli")).toContain(
      worded(DE, "Target {{target}} · not evaluated yet", {
        target: germanPercent("99,9"),
      }),
    );
    expectNoEnglishNotes();
  });

  test.each([
    ["a healthy", HEALTHY, ["99,95", "62,5", "0,5×"]],
    ["a burning", BURNING, ["99,812", "15", "14,4×"]],
    ["an overspent", OVERSPENT, ["99,5", "3×"]],
    ["a not-yet-evaluated", {}, ["99,9"]],
  ])(
    "German: %s SLO's strip writes no figure with an English decimal point",
    (
      _name: string,
      overrides: Partial<Record<keyof ServiceLevelObjective, unknown>>,
      figures: Array<string>,
    ) => {
      renderStrip(overrides);

      const text: string = KPI_TILES.map(tileText).join("\n");

      // "99,812 %", "14,4×" and "0,088": the figures German writes (#6695).
      expect(text).not.toMatch(DECIMAL_POINT);

      for (const figure of figures) {
        expect({ figure, shown: text.includes(figure) }).toEqual({
          figure,
          shown: true,
        });
      }

      // Each percentage has the no-break space German puts before its sign.
      expect(text).not.toMatch(/[0-9]%/);
    },
  );

  test("German: an overspent budget says so, with how far over", () => {
    renderStrip(OVERSPENT);

    expect(tileText("slo-kpi-budget")).toContain(worded(DE, "Budget exceeded"));
    expect(tileText("slo-kpi-budget")).toContain(
      worded(DE, "{{remaining}} over budget · {{total}} allowed", {
        remaining: formatDurationCompactInLanguage(300, "de"),
        total: formatDurationCompactInLanguage(2592, "de"),
      }),
    );
    expect(tileText("slo-kpi-runway")).toContain(worded(DE, "Overspent"));
    expect(tileText("slo-kpi-runway")).toContain(
      worded(DE, "{{duration}} over budget", {
        duration: formatDurationCompactInLanguage(300, "de"),
      }),
    );
    expectNoEnglishNotes();
  });

  test.each([
    ["a healthy", HEALTHY],
    ["a burning", BURNING],
    ["an overspent", OVERSPENT],
    ["a not-yet-evaluated", {}],
  ])(
    "Arabic: %s SLO's tiles hold no Latin word past the SLI's name",
    async (
      _name: string,
      overrides: Partial<Record<keyof ServiceLevelObjective, unknown>>,
    ) => {
      await act(async () => {
        await i18next.changeLanguage("ar");
      });

      renderStrip(overrides);

      for (const id of KPI_TILES) {
        expect({ id, latin: latinWordsIn(tileText(id), ["SLI"]) }).toEqual({
          id,
          latin: [],
        });
      }
    },
  );

  test("Arabic: each figure inside a note is set apart, so it keeps its place in the sentence", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    renderStrip(BURNING);

    expect(tileText("slo-kpi-sli")).toContain(
      worded(AR, "{{delta}} pp below the {{target}} target", {
        delta: setApart("0.088"),
        target: setApart(percentIn("ar", 99.9)),
      }),
    );
    expect(tileText("slo-kpi-budget")).toContain(
      worded(AR, "{{remaining}} left of {{total}}", {
        remaining: setApart(formatDurationCompactInLanguage(389, "ar")),
        total: setApart(formatDurationCompactInLanguage(2592, "ar")),
      }),
    );
    expect(tileText("slo-kpi-burn-rate")).toContain(
      setApart(formatDurationCompactInLanguage(3600, "ar")),
    );

    /*
     * The runway's headline is a value on its own: "~" and an Arabic
     * duration, with no isolate's marks to draw.
     */
    const runwayValue: HTMLElement = within(
      document.getElementById("slo-kpi-runway") as HTMLElement,
    ).getByText((content: string): boolean => {
      return content.startsWith("~");
    });
    expect(runwayValue.textContent).not.toContain(FIRST_STRONG_ISOLATE);
    expect(latinWordsIn(runwayValue.textContent || "", [])).toEqual([]);
  });

  test("Arabic: not yet evaluated, the target is set apart in the Arabic line", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    renderStrip({});

    expect(tileText("slo-kpi-sli")).toContain(
      worded(AR, "Target {{target}} · not evaluated yet", {
        target: setApart(percentIn("ar", 99.9)),
      }),
    );
    // Arabic writes Latin digits, as the rest of OneUptime does.
    expect(tileText("slo-kpi-sli")).not.toMatch(/[\u0660-\u0669]/);
  });
});

describe("the SLO overview's getting-started card and empty states", () => {
  test("German counts the ready rules, Arabic names the count with a label", async () => {
    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={2}
      />,
    );
    expect(document.body.textContent).toContain(
      worded(
        DE,
        "{{count}} burn rate rules are ready to alert when the budget burns too fast. Adjust thresholds, severities and who gets paged.",
        { count: "2" },
      ),
    );
    cleanup();

    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={12}
      />,
    );
    expect(document.body.textContent).toContain(
      "قواعد معدل الاستهلاك الجاهزة للتنبيه عندما تُستهلك الميزانية بسرعة كبيرة: 12.",
    );
  });

  test("an empty state looks its title and description up, and draws a worded one as it is", () => {
    render(
      <SloOverviewEmptyState
        icon={IconProp.CheckCircle}
        title="Nothing needs attention right now"
        description="No burn rate rule is enabled yet, so nothing will alert when the budget burns too fast."
        dataTestId="empty"
      />,
    );

    const empty: HTMLElement = screen.getByTestId("empty");

    expect(empty).toHaveTextContent(
      worded(DE, "Nothing needs attention right now"),
    );
    expect(empty).toHaveTextContent(
      worded(
        DE,
        "No burn rate rule is enabled yet, so nothing will alert when the budget burns too fast.",
      ),
    );
    cleanup();

    // A sentence a caller has already worded has no key: drawn as given.
    render(
      <SloOverviewEmptyState
        icon={IconProp.CheckCircle}
        title="Alles im grünen Bereich"
        description="Die 3 Monitore laufen."
        dataTestId="empty"
      />,
    );
    expect(screen.getByTestId("empty")).toHaveTextContent(
      "Alles im grünen Bereich",
    );
    expect(screen.getByTestId("empty")).toHaveTextContent(
      "Die 3 Monitore laufen.",
    );
  });
});

describe("the two-factor status card in German and Arabic", () => {
  test("German: the status badge and what it means", async () => {
    mockUser = { enableTwoFactorAuth: true };
    render(<TwoFactorStatus />);

    expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
      worded(DE, "Enabled"),
    );
    expect(
      screen.getByText(
        worded(
          DE,
          "Use an authenticator app or security key for your second step.",
        ),
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      "Use an authenticator app or security key",
    );
  });

  test("Arabic: not enabled, and why a status that cannot be read is not called off", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    mockUser = { enableTwoFactorAuth: false };
    render(<TwoFactorStatus />);
    expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
      worded(AR, "Not enabled"),
    );
    cleanup();

    mockUser = null;
    render(<TwoFactorStatus />);
    expect(
      await screen.findByText(
        worded(
          AR,
          "Your two-factor authentication status could not be loaded.",
        ),
      ),
    ).toBeInTheDocument();
  });
});

describe("a workspace row's Send Test button in German and Arabic", () => {
  test("German: what a screen reader hears, and the result it reports", async () => {
    render(
      <SendTestNotificationButton
        route="/slack/channels/test"
        requestBody={{ channelId: "C0123ALERTS" }}
        destinationName="#alerts"
        workspaceName="Slack"
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: worded(DE, "Send test notification to {{destination}}", {
        destination: "#alerts",
      }),
    });

    await act(async () => {
      fireEvent.click(button);
    });

    const sent: HTMLElement = await screen.findByTestId(
      "send-test-notification-sent",
    );

    expect(sent).toHaveTextContent(worded(DE, "Sent"));
    expect(sent).toHaveAttribute(
      "title",
      worded(
        DE,
        "Test notification sent to {{destination}}. Check {{workspace}} to confirm it arrived.",
        { destination: "#alerts", workspace: "Slack" },
      ),
    );
  });

  test("Arabic: a failed send says so in Arabic, the server's reason beside it", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    mockPostResult = new Error("channel_not_found");

    render(
      <SendTestNotificationButton
        route="/microsoft-teams/chats/test"
        requestBody={{ chatId: "19:war-room@thread.v2" }}
        destinationName="Incident War Room"
        workspaceName="Microsoft Teams"
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: worded(AR, "Send test notification to {{destination}}", {
            destination: "Incident War Room",
          }),
        }),
      );
    });

    expect(
      await screen.findByTestId("send-test-notification-failed"),
    ).toHaveTextContent(worded(AR, "Failed"));
    /*
     * The channel's and the workspace's names are in Latin letters: each is
     * set apart, so an Arabic sentence keeps "في" before the workspace and
     * its full stop at its end.
     */
    expect(
      screen.getByText(
        worded(
          AR,
          "OneUptime could not send a test notification to {{destination}} in {{workspace}}.",
          {
            destination: setApart("Incident War Room"),
            workspace: setApart("Microsoft Teams"),
          },
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("channel_not_found")).toBeInTheDocument();
  });

  test("German: the failed send's sentence carries no isolate marks, Latin names in a Latin sentence", async () => {
    mockPostResult = new Error("channel_not_found");

    render(
      <SendTestNotificationButton
        route="/microsoft-teams/chats/test"
        requestBody={{ chatId: "19:war-room@thread.v2" }}
        destinationName="Incident War Room"
        workspaceName="Microsoft Teams"
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: worded(DE, "Send test notification to {{destination}}", {
            destination: "Incident War Room",
          }),
        }),
      );
    });

    expect(
      await screen.findByText(
        worded(
          DE,
          "OneUptime could not send a test notification to {{destination}} in {{workspace}}.",
          {
            destination: "Incident War Room",
            workspace: "Microsoft Teams",
          },
        ),
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(FIRST_STRONG_ISOLATE);
  });
});
