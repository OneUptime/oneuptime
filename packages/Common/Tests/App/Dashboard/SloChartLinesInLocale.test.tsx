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
import { act, cleanup, render, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE SLO CHARTS' LINES: IN A LEGEND, IN THE READER'S FIGURES (#6694, #6695).
 *
 * The Overview's error budget burn-down wrote "At risk (25%)" and "Budget
 * exhausted" at the right end of their lines: the first sat on the budget
 * curve whenever the budget ran near it - the usual case for an SLO at risk
 * - and the second, at 0%, on the time axis's last tick, worse in German
 * ("Budget ausgeschöpft") and Russian. The card, and the three charts of the
 * Metrics page's Error Budget History, now name their lines in a legend
 * under the chart (ReferenceLineLabelPlacement.Legend), and every figure on
 * them - the axis, the tooltip and the lines' labels - is written the
 * reader's way: "Gefährdet (25 %)", "Ziel 99,9 %", "Fast burn 14,4×".
 *
 * The chart is a recorder (recharts draws nothing in jsdom): what is
 * asserted is what each card hands it.
 */

const aggregateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const lineChartMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (error as Error).message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: { data: Array<{ seriesName: string }> }) => {
      lineChartMock(props);
      return <div data-testid={`line-chart-${props.data[0]?.seriesName}`} />;
    },
  };
});

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="range-picker" />;
    },
  };
});

import SloBudgetBurnDownCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBudgetBurnDownCard";
import SloHistoryCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloHistoryCharts";
import {
  getSloPolicyTierLineLabel,
  getSloPolicyTierReferenceLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloPolicyTier";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import { Translator } from "../../../Types/Translator";
import ChartReferenceLineProps, {
  ReferenceLineLabelPlacement,
} from "../../../UI/Components/Charts/Types/ReferenceLineProps";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const EN: Record<string, string> = readDashboardLocale("en");
const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");
const AR: Record<string, string> = readDashboardLocale("ar");

const NO_BREAK_SPACE: string = "\u00A0";
// U+200E, either side of a burn rate's sign on a page read right to left.
const LEFT_TO_RIGHT_MARK: string = String.fromCharCode(0x200e);
const SLO_ID: ObjectID = new ObjectID("0193c0de-5555-4aaa-8bbb-000000000005");
const NOW: Date = new Date("2026-09-15T12:00:00.000Z");

// A figure with an English decimal point: "99.9", "14.4".
const DECIMAL_POINT: RegExp = /[0-9]\.[0-9]/;

function germanPercent(figure: string): string {
  return `${figure}${NO_BREAK_SPACE}%`;
}

interface ChartProps {
  data: Array<{ seriesName: string }>;
  yAxis: { options: { formatter: (value: number) => string } };
  referenceLines?: Array<ChartReferenceLineProps> | undefined;
  referenceLineLabelPlacement?: ReferenceLineLabelPlacement | undefined;
}

function chartsDrawn(): Array<ChartProps> {
  return lineChartMock.mock.calls.map((args: Array<unknown>): ChartProps => {
    return args[0] as ChartProps;
  });
}

// The last props the chart named `seriesName` (as drawn) was handed.
function lastChart(seriesName: string): ChartProps {
  const charts: Array<ChartProps> = chartsDrawn().filter(
    (props: ChartProps): boolean => {
      return props.data[0]?.seriesName === seriesName;
    },
  );

  expect({ seriesName, drawn: charts.length > 0 }).toEqual({
    seriesName,
    drawn: true,
  });

  return charts[charts.length - 1]!;
}

function labelsOf(chart: ChartProps): Array<string | undefined> {
  return (chart.referenceLines || []).map(
    (line: ChartReferenceLineProps): string | undefined => {
      return line.label;
    },
  );
}

function makeTier(
  name: string,
  thresholdPercentage: number,
): ServiceLevelObjectiveErrorBudgetPolicyTier {
  const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
    new ServiceLevelObjectiveErrorBudgetPolicyTier();
  tier.name = name;
  tier.thresholdPercentage = thresholdPercentage;
  tier.isEnabled = true;
  return tier;
}

function makeRule(
  name: string,
  burnRateThreshold: number,
): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule.name = name;
  rule.burnRateThreshold = burnRateThreshold;
  return rule;
}

function makeSlo(): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.timezone = "UTC";
  slo.atRiskThresholdPercentage = 25;
  slo.lastEvaluatedAt = new Date("2026-09-15T11:58:00.000Z");
  return slo;
}

const TIERS: Array<ServiceLevelObjectiveErrorBudgetPolicyTier> = [
  makeTier("Caution", 50),
  makeTier("Change freeze", 12.5),
];

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
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
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  aggregateMock.mockImplementation(async (args: unknown) => {
    const request: {
      aggregateBy: {
        startTimestamp: Date;
        endTimestamp: Date;
        query?: { metricName?: string };
      };
    } = args as {
      aggregateBy: {
        startTimestamp: Date;
        endTimestamp: Date;
        query?: { metricName?: string };
      };
    };
    const end: number = request.aggregateBy.endTimestamp.getTime();

    return {
      data: [
        {
          timestamp: new Date(end - 60 * 60 * 1000).toISOString(),
          value: 62.5,
        },
      ],
    };
  });
  getItemMock.mockResolvedValue(makeSlo());
  getListMock.mockImplementation((args: unknown) => {
    const modelType: unknown = (args as { modelType: unknown }).modelType;
    const data: Array<unknown> =
      modelType === ServiceLevelObjectiveErrorBudgetPolicyTier
        ? TIERS
        : [makeRule("Fast burn", 14.4)];

    return Promise.resolve({
      data: data,
      count: data.length,
      skip: 0,
      limit: 10000,
    });
  });
  await inLanguage("de");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  lineChartMock.mockReset();
  aggregateMock.mockReset();
  getItemMock.mockReset();
  getListMock.mockReset();
});

async function renderBurnDown(): Promise<ChartProps> {
  render(
    <MemoryRouter>
      <SloBudgetBurnDownCard
        sloId={SLO_ID}
        slo={makeSlo()}
        refreshToken="t1"
        policyTiers={TIERS}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(chartsDrawn().length).toBeGreaterThan(0);
  });

  const charts: Array<ChartProps> = chartsDrawn();

  return charts[charts.length - 1]!;
}

describe("the Overview's error budget burn-down", () => {
  test("names its lines in a legend under the chart, never at the end of a line", async () => {
    const chart: ChartProps = await renderBurnDown();

    expect(chart.referenceLineLabelPlacement).toBe(
      ReferenceLineLabelPlacement.Legend,
    );
  });

  test("German: the lines' labels and the axis in German words and figures", async () => {
    const chart: ChartProps = await renderBurnDown();

    expect(labelsOf(chart)).toEqual([
      DE["Budget exhausted"],
      DE["At risk ({{percent}})"]!.replace("{{percent}}", germanPercent("25")),
      `Caution ${germanPercent("50")}`,
      `Change freeze ${germanPercent("12,5")}`,
    ]);
    expect(DE["Budget exhausted"]).not.toBe(EN["Budget exhausted"]);
    expect(labelsOf(chart).join(" ")).not.toMatch(DECIMAL_POINT);
    // The axis and the tooltip: "62,5 %".
    expect(chart.yAxis.options.formatter(62.5)).toBe(germanPercent("62,5"));
    // An overspent budget, rounded as the English is ("-3.2%").
    expect(chart.yAxis.options.formatter(-3.25)).toBe(germanPercent("-3,2"));
  });

  test("English: the labels and the axis read as before", async () => {
    await inLanguage("en");

    const chart: ChartProps = await renderBurnDown();

    expect(labelsOf(chart)).toEqual([
      "Budget exhausted",
      "At risk (25%)",
      "Caution 50%",
      "Change freeze 12.5%",
    ]);
    expect(chart.yAxis.options.formatter(62.5)).toBe("62.5%");
    expect(chart.yAxis.options.formatter(-3.25)).toBe("-3.2%");
    expect(chart.referenceLineLabelPlacement).toBe(
      ReferenceLineLabelPlacement.Legend,
    );
  });

  test("Persian: the figures in Persian digits", async () => {
    await inLanguage("fa");

    const chart: ChartProps = await renderBurnDown();

    expect(labelsOf(chart)).toEqual([
      FA["Budget exhausted"],
      FA["At risk ({{percent}})"]!.replace("{{percent}}", "۲۵٪"),
      "Caution ۵۰٪",
      "Change freeze ۱۲٫۵٪",
    ]);
    expect(chart.yAxis.options.formatter(62.5)).toBe("۶۲٫۵٪");
  });
});

describe("the Metrics page's Error Budget History charts", () => {
  async function renderCharts(): Promise<void> {
    render(<SloHistoryCharts sloId={SLO_ID} />);

    await waitFor(() => {
      expect(
        chartsDrawn().filter((props: ChartProps) => {
          return (props.referenceLines || []).length > 0;
        }).length,
      ).toBeGreaterThanOrEqual(3);
    });
  }

  test("German: each chart names its lines in a legend, with German figures", async () => {
    await renderCharts();

    const sli: ChartProps = lastChart(DE["SLI %"] || "SLI %");
    const budget: ChartProps = lastChart(DE["Budget Remaining %"]!);
    const burnRate: ChartProps = lastChart(DE["Burn Rate"]!);

    for (const chart of [sli, budget, burnRate]) {
      expect(chart.referenceLineLabelPlacement).toBe(
        ReferenceLineLabelPlacement.Legend,
      );
      expect(labelsOf(chart).join(" ")).not.toMatch(DECIMAL_POINT);
    }

    expect(labelsOf(sli)).toEqual([
      DE["Target {{target}}"]!.replace("{{target}}", germanPercent("99,9")),
    ]);
    expect(labelsOf(budget)).toEqual([
      DE["Budget exhausted"],
      DE["At risk ({{percent}})"]!.replace("{{percent}}", germanPercent("25")),
      `Caution ${germanPercent("50")}`,
      `Change freeze ${germanPercent("12,5")}`,
    ]);
    expect(labelsOf(burnRate)).toEqual(["Fast burn 14,4×"]);

    // The axes and the tooltips: German figures with each chart's precision.
    expect(sli.yAxis.options.formatter(99.8745)).toBe(germanPercent("99,875"));
    expect(budget.yAxis.options.formatter(42.456)).toBe(germanPercent("42,46"));
    expect(burnRate.yAxis.options.formatter(3.256)).toBe("3,26×");
  });

  test("English: every label and axis reads as before", async () => {
    await inLanguage("en");
    await renderCharts();

    const sli: ChartProps = lastChart("SLI %");
    const budget: ChartProps = lastChart("Budget Remaining %");
    const burnRate: ChartProps = lastChart("Burn Rate");

    expect(labelsOf(sli)).toEqual(["Target 99.9%"]);
    expect(labelsOf(budget)).toEqual([
      "Budget exhausted",
      "At risk (25%)",
      "Caution 50%",
      "Change freeze 12.5%",
    ]);
    expect(labelsOf(burnRate)).toEqual(["Fast burn 14.4×"]);
    expect(sli.yAxis.options.formatter(99.8745)).toBe("99.875%");
    expect(budget.yAxis.options.formatter(42.456)).toBe("42.46%");
    expect(burnRate.yAxis.options.formatter(3.256)).toBe("3.26×");

    for (const chart of [sli, budget, burnRate]) {
      expect(chart.referenceLineLabelPlacement).toBe(
        ReferenceLineLabelPlacement.Legend,
      );
    }
  });

  test("Arabic: a rule's threshold keeps its sign after the figure, as on the rule's own card", async () => {
    await inLanguage("ar");
    await renderCharts();

    const burnRate: ChartProps = lastChart(AR["Burn Rate"]!);

    /*
     * The sign between two left-to-right marks: a bare "×" at the end of a
     * label read right to left was drawn before the label instead -
     * "×Fast burn 14.4".
     */
    expect(labelsOf(burnRate)).toEqual([
      `Fast burn 14.4${LEFT_TO_RIGHT_MARK}×${LEFT_TO_RIGHT_MARK}`,
    ]);
    expect(burnRate.yAxis.options.formatter(3.256)).toBe(
      `3.26${LEFT_TO_RIGHT_MARK}×${LEFT_TO_RIGHT_MARK}`,
    );
  });

  test("the at-risk line is named as on the Overview's burn-down, with its figure", async () => {
    await renderCharts();

    const budget: ChartProps = lastChart(DE["Budget Remaining %"]!);

    cleanup();
    lineChartMock.mockReset();

    const burnDown: ChartProps = await renderBurnDown();

    expect(labelsOf(budget)[1]).toBe(labelsOf(burnDown)[1]);
    expect(labelsOf(budget)[1]).toBe(
      DE["At risk ({{percent}})"]!.replace("{{percent}}", germanPercent("25")),
    );
  });

  test("the target's line has a key of its own in every language, its figure written apart from it", () => {
    for (const language of ["de", "fa", "ar", "ja"]) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        worded: words["Target {{target}}"]?.includes("{{target}}"),
        noSign: !words["Target {{target}}"]?.includes("%"),
      }).toEqual({ language, worded: true, noSign: true });
    }
  });
});

describe("a policy tier's line label, in the reader's figures", () => {
  const GERMAN: Translator = dashboardTranslator("de");
  const PERSIAN: Translator = dashboardTranslator("fa");

  test("the tier's name as written and its threshold the reader's way", () => {
    expect(
      getSloPolicyTierLineLabel({ name: "Caution", thresholdPercentage: "50" }),
    ).toBe("Caution 50%");
    expect(
      getSloPolicyTierLineLabel(
        { name: "Caution", thresholdPercentage: "12.5" },
        GERMAN,
      ),
    ).toBe(`Caution ${germanPercent("12,5")}`);
    expect(
      getSloPolicyTierLineLabel(
        { name: "Vorsicht", thresholdPercentage: 50 },
        PERSIAN,
      ),
    ).toBe("Vorsicht ۵۰٪");
  });

  test("a tier said on a line already drawn joins it with the separator the language puts between facts", () => {
    const lines: Array<ChartReferenceLineProps> = [
      { value: 0, label: "Budget exhausted", color: "#ef4444" },
    ];
    const tiers: Array<{
      name: string;
      thresholdPercentage: number;
      isEnabled: boolean;
    }> = [{ name: "Freeze", thresholdPercentage: 0, isEnabled: true }];

    expect(
      getSloPolicyTierReferenceLines({ lines: lines, tiers: tiers })[0]?.label,
    ).toBe("Budget exhausted · Freeze 0%");
    expect(
      getSloPolicyTierReferenceLines({
        lines: lines,
        tiers: tiers,
        translator: GERMAN,
      })[0]?.label,
    ).toBe(`Budget exhausted · Freeze ${germanPercent("0")}`);
    // Persian writes its zero as a dot: a bullet stands between the facts.
    expect(
      getSloPolicyTierReferenceLines({
        lines: lines,
        tiers: tiers,
        translator: PERSIAN,
      })[0]?.label,
    ).toBe("Budget exhausted • Freeze ۰٪");
  });
});
