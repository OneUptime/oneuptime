import { describe, expect, test } from "@jest/globals";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import {
  KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS,
  KUBERNETES_COST_METRIC_DESCRIPTIONS,
  KUBERNETES_COST_OVERVIEW_DESCRIPTIONS,
  KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS,
  KubernetesCostOverviewMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import {
  COST_OVERVIEW_RUN_RATE_DAYS,
  COST_OVERVIEW_SPEND_WINDOW_HOURS,
  HOURS_PER_MONTH,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostOverview";

/*
 * The (i) texts of the cluster overview's Cost card (#9548): each passes the
 * shared rules, fits the small tooltip, sits beside its tile's title, and
 * says what the card computes - the fixed windows, the run-rate's month, the
 * thresholds its bars are coloured by.
 */

const OVERVIEW: Record<KubernetesCostOverviewMetric, string> =
  KUBERNETES_COST_OVERVIEW_DESCRIPTIONS;

// Each tile's title, as the card draws it.
const TITLED: Array<[string, string]> = [
  ["Last 24 Hours", OVERVIEW.lastDaySpend],
  ["Monthly Run-Rate", OVERVIEW.monthlyRunRate],
  ["Idle Spend", OVERVIEW.idleSpend],
  ["Efficiency", OVERVIEW.efficiency],
];

describe("the cost card's tooltips", () => {
  test("pass the shared rules", () => {
    expectReadableDescriptionRecord(
      OVERVIEW,
      "KUBERNETES_COST_OVERVIEW_DESCRIPTIONS",
    );
  });

  test("cover exactly the card's four tiles", () => {
    expect(Object.keys(OVERVIEW).sort()).toEqual(
      ["efficiency", "idleSpend", "lastDaySpend", "monthlyRunRate"].sort(),
    );
  });

  test("each fits the small tooltip (aim: 260 chars)", () => {
    for (const text of Object.values(OVERVIEW)) {
      expect({ text, length: text.length <= 260 }).toEqual({
        text,
        length: true,
      });
    }
  });

  test("borrow no words from the cluster's other tooltips", () => {
    const others: Set<string> = new Set<string>([
      ...Object.values(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS),
      ...Object.values(KUBERNETES_COST_METRIC_DESCRIPTIONS),
      ...Object.values(KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS),
    ]);

    for (const text of Object.values(OVERVIEW)) {
      expect(others.has(text)).toBe(false);
    }
  });

  test.each(TITLED)(
    "%s is explained by the text beside it",
    (title: string, text: string) => {
      expectTitleExplained(title, text);
    },
  );

  test("every text sits beside a tile", () => {
    const shown: Set<string> = new Set<string>(
      TITLED.map((pair: [string, string]): string => {
        return pair[1];
      }),
    );

    for (const text of Object.values(OVERVIEW)) {
      expect({ text, shown: shown.has(text) }).toEqual({ text, shown: true });
    }
  });
});

describe("the cost card's tooltips say what the card computes", () => {
  test("the spend tile reads the last 24 hours, idle capacity included, and not the page's range", () => {
    expect(COST_OVERVIEW_SPEND_WINDOW_HOURS).toBe(24);
    expect(OVERVIEW.lastDaySpend).toContain("last 24 hours");
    expect(OVERVIEW.lastDaySpend).toContain("idle capacity included");
    expect(OVERVIEW.lastDaySpend).toContain("Ignores the time range picker");
  });

  test("the run-rate is the last 7 days' hourly average times 730, hours with no data left out", () => {
    expect(COST_OVERVIEW_RUN_RATE_DAYS).toBe(7);
    expect(HOURS_PER_MONTH).toBe(730);
    expect(OVERVIEW.monthlyRunRate).toContain("last 7 days");
    expect(OVERVIEW.monthlyRunRate).toContain("730");
    expect(OVERVIEW.monthlyRunRate).toContain("not counted as free");
    // An estimate at the engine's prices, which a reader must not mistake for a bill.
    expect(OVERVIEW.monthlyRunRate).toContain("not your cloud bill");
  });

  test("the idle and efficiency tiles name the thresholds their bars turn at", () => {
    expect(OVERVIEW.idleSpend).toContain("Amber from 25%, red from 40%");
    expect(OVERVIEW.efficiency).toContain("Green from 70%, red below 40%");
    expect(OVERVIEW.efficiency).toContain("weighted by what it cost");
  });
});
