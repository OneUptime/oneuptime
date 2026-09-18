import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import SloMetricType from "../../../Types/ServiceLevelObjective/SloMetricType";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "../../../Utils/Slo/SloEvaluation";
import SloMetricTypeUtil, {
  SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE,
  SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE,
  SLO_METRIC_PROJECT_ID_ATTRIBUTE,
  SLO_METRIC_SLO_ID_ATTRIBUTE,
  SLO_METRIC_SLO_NAME_ATTRIBUTE,
} from "../../../Utils/Slo/SloMetricType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SloMetricTypeUtil is the one table both sides of the SLO metric store read:
 * SloMetricUtil registers each name's catalog unit and description from it,
 * and the SLO Metrics page titles, legends and aggregates the same series
 * from it. Two kinds of test, as in MonitorMetricType.test.ts:
 *
 *   - Targeted: the exact aggregation / unit / status encoding per member,
 *     because each is a decision a chart or a stored row depends on.
 *   - Invariant: every lookup resolves for EVERY enum member. The switches
 *     throw on an unknown value, so a member added to the enum and forgotten
 *     in one switch fails here instead of throwing inside the worker.
 */

const ALL_SLO_METRIC_TYPES: Array<SloMetricType> = Object.values(SloMetricType);

// A value outside the enum, to drive the throwing default branches.
const UNKNOWN_METRIC_TYPE: SloMetricType =
  "oneuptime.slo.not.a.metric" as SloMetricType;

describe("SloMetricTypeUtil.getAll", () => {
  test("lists every SloMetricType exactly once - the emitter writes only what is listed", () => {
    const all: Array<SloMetricType> = SloMetricTypeUtil.getAll();

    expect([...all].sort()).toEqual([...ALL_SLO_METRIC_TYPES].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  test("orders the objective series first and status last, the order the Metrics page reads in", () => {
    expect(SloMetricTypeUtil.getAll()).toEqual([
      SloMetricType.SliPercent,
      SloMetricType.TargetPercent,
      SloMetricType.ErrorBudgetRemainingPercent,
      SloMetricType.ErrorBudgetRemainingSeconds,
      SloMetricType.BurnRate,
      SloMetricType.Status,
    ]);
  });

  test("returns a fresh array, so one caller reordering it cannot reorder another's", () => {
    const first: Array<SloMetricType> = SloMetricTypeUtil.getAll();
    first.reverse();

    expect(SloMetricTypeUtil.getAll()[0]).toBe(SloMetricType.SliPercent);
  });
});

describe("metric names", () => {
  test.each(ALL_SLO_METRIC_TYPES)(
    "%s lives under the oneuptime.slo. namespace",
    (metricType: SloMetricType) => {
      expect(metricType.startsWith("oneuptime.slo.")).toBe(true);
    },
  );

  test.each(ALL_SLO_METRIC_TYPES)(
    "%s is not a mutable-metric name, so reads find it in MetricItemV3 where it is written",
    (metricType: SloMetricType) => {
      /*
       * The prefixes MutableMetricService routes to MutableMetricItem. The
       * server-side SloMetricUtil suite asserts the same against the real
       * isMutableMetricName; this copy keeps the check in a React-free suite.
       */
      for (const prefix of [
        "oneuptime.incident.",
        "oneuptime.alert.",
        "oneuptime.scheduled-maintenance.",
      ]) {
        expect(metricType.startsWith(prefix)).toBe(false);
      }
    },
  );
});

describe("SloMetricTypeUtil.getAggregationType", () => {
  test.each([
    [SloMetricType.SliPercent, AggregationType.Avg],
    [SloMetricType.TargetPercent, AggregationType.Avg],
    [SloMetricType.ErrorBudgetRemainingPercent, AggregationType.Avg],
    [SloMetricType.ErrorBudgetRemainingSeconds, AggregationType.Avg],
    // A spike, or a short trip into Budget Exhausted, must survive a coarse bucket.
    [SloMetricType.BurnRate, AggregationType.Max],
    [SloMetricType.Status, AggregationType.Max],
  ])("%s aggregates with %s", (metricType: SloMetricType, expected: string) => {
    expect(SloMetricTypeUtil.getAggregationType(metricType)).toBe(expected);
  });

  test("throws on a value outside the enum", () => {
    expect(() => {
      SloMetricTypeUtil.getAggregationType(UNKNOWN_METRIC_TYPE);
    }).toThrow("Invalid SloMetricType value");
  });
});

describe("SloMetricTypeUtil.getUnit and getLegendUnit", () => {
  test.each([
    [SloMetricType.SliPercent, "%"],
    [SloMetricType.TargetPercent, "%"],
    [SloMetricType.ErrorBudgetRemainingPercent, "%"],
    // The incident / alert duration spelling, which the chart formatter scales.
    [SloMetricType.ErrorBudgetRemainingSeconds, "seconds"],
    [SloMetricType.BurnRate, "x"],
    [SloMetricType.Status, ""],
  ])(
    "%s is registered with unit %p",
    (metricType: SloMetricType, unit: string) => {
      expect(SloMetricTypeUtil.getUnit(metricType)).toBe(unit);
    },
  );

  test.each(ALL_SLO_METRIC_TYPES)(
    "%s charts with exactly the unit the catalog row carries",
    (metricType: SloMetricType) => {
      expect(SloMetricTypeUtil.getLegendUnit(metricType)).toBe(
        SloMetricTypeUtil.getUnit(metricType),
      );
    },
  );

  test('never registers a percentage as the OTel fraction unit "1", which charts would multiply by 100', () => {
    for (const metricType of ALL_SLO_METRIC_TYPES) {
      expect(SloMetricTypeUtil.getUnit(metricType)).not.toBe("1");
    }
  });

  test("throws on a value outside the enum", () => {
    expect(() => {
      SloMetricTypeUtil.getUnit(UNKNOWN_METRIC_TYPE);
    }).toThrow("Invalid SloMetricType value");
    expect(() => {
      SloMetricTypeUtil.getLegendUnit(UNKNOWN_METRIC_TYPE);
    }).toThrow("Invalid SloMetricType value");
  });
});

describe("titles, legends and descriptions", () => {
  test.each(ALL_SLO_METRIC_TYPES)(
    "%s resolves a non-empty title, legend and description",
    (metricType: SloMetricType) => {
      expect(SloMetricTypeUtil.getTitle(metricType).trim()).not.toBe("");
      expect(SloMetricTypeUtil.getLegend(metricType).trim()).not.toBe("");
      expect(SloMetricTypeUtil.getDescription(metricType).trim()).not.toBe("");
    },
  );

  test("no two metrics share a title, so two cards can never look like the same chart", () => {
    const titles: Array<string> = ALL_SLO_METRIC_TYPES.map(
      (metricType: SloMetricType): string => {
        return SloMetricTypeUtil.getTitle(metricType);
      },
    );

    expect(new Set(titles).size).toBe(titles.length);
  });

  test.each([
    [SloMetricType.SliPercent, "SLI", "SLI"],
    [SloMetricType.TargetPercent, "Target", "Target"],
    [
      SloMetricType.ErrorBudgetRemainingPercent,
      "Error Budget Remaining",
      "Budget Remaining",
    ],
    [
      SloMetricType.ErrorBudgetRemainingSeconds,
      "Error Budget Remaining Time",
      "Budget Remaining",
    ],
    [SloMetricType.BurnRate, "Burn Rate", "Burn Rate"],
    [SloMetricType.Status, "Status", "Status"],
  ])(
    "%s is titled %p with legend %p",
    (metricType: SloMetricType, title: string, legend: string) => {
      expect(SloMetricTypeUtil.getTitle(metricType)).toBe(title);
      expect(SloMetricTypeUtil.getLegend(metricType)).toBe(legend);
    },
  );

  test("the burn rate description names the lookback the worker actually measures over", () => {
    expect(SloMetricTypeUtil.getDescription(SloMetricType.BurnRate)).toContain(
      `trailing ${SLO_CURRENT_BURN_RATE_WINDOW_MINUTES} minutes`,
    );
  });

  test("the status description documents the numeric encoding a chart reader sees", () => {
    const description: string = SloMetricTypeUtil.getDescription(
      SloMetricType.Status,
    );

    expect(description).toContain("0 = Healthy");
    expect(description).toContain("1 = At Risk");
    expect(description).toContain("2 = Budget Exhausted");
  });

  test("the remaining-budget descriptions say the value goes negative once overspent", () => {
    expect(
      SloMetricTypeUtil.getDescription(
        SloMetricType.ErrorBudgetRemainingPercent,
      ),
    ).toContain("Negative");
    expect(
      SloMetricTypeUtil.getDescription(
        SloMetricType.ErrorBudgetRemainingSeconds,
      ),
    ).toContain("Negative");
  });

  test("every lookup throws on a value outside the enum", () => {
    expect(() => {
      SloMetricTypeUtil.getTitle(UNKNOWN_METRIC_TYPE);
    }).toThrow("Invalid SloMetricType value");
    expect(() => {
      SloMetricTypeUtil.getLegend(UNKNOWN_METRIC_TYPE);
    }).toThrow("Invalid SloMetricType value");
    expect(() => {
      SloMetricTypeUtil.getDescription(UNKNOWN_METRIC_TYPE);
    }).toThrow("Invalid SloMetricType value");
  });
});

describe("the Status series encoding", () => {
  test.each([
    [SloStatus.Healthy, 0],
    [SloStatus.AtRisk, 1],
    [SloStatus.BudgetExhausted, 2],
  ])("%s posts %s", (status: SloStatus, value: number) => {
    expect(SloMetricTypeUtil.getStatusMetricValue(status)).toBe(value);
  });

  test.each([
    ["Misconfigured", SloStatus.Misconfigured],
    ["Paused", SloStatus.Paused],
    ["undefined", undefined],
    ["null", null],
  ])(
    "%s posts no point at all",
    (_name: string, status: SloStatus | undefined | null) => {
      expect(SloMetricTypeUtil.getStatusMetricValue(status)).toBeNull();
    },
  );

  test("values rise with severity, so the Max aggregation keeps the worst state in a bucket", () => {
    expect(
      SloMetricTypeUtil.getStatusMetricValue(SloStatus.Healthy)!,
    ).toBeLessThan(SloMetricTypeUtil.getStatusMetricValue(SloStatus.AtRisk)!);
    expect(
      SloMetricTypeUtil.getStatusMetricValue(SloStatus.AtRisk)!,
    ).toBeLessThan(
      SloMetricTypeUtil.getStatusMetricValue(SloStatus.BudgetExhausted)!,
    );
  });

  test.each([SloStatus.Healthy, SloStatus.AtRisk, SloStatus.BudgetExhausted])(
    "%s round-trips through its posted value",
    (status: SloStatus) => {
      expect(
        SloMetricTypeUtil.getStatusFromMetricValue(
          SloMetricTypeUtil.getStatusMetricValue(status)!,
        ),
      ).toBe(status);
    },
  );

  test.each([
    [0.4, SloStatus.Healthy],
    [0.5, SloStatus.AtRisk],
    [1.49, SloStatus.AtRisk],
    [1.6, SloStatus.BudgetExhausted],
  ])(
    "a re-averaged bucket value of %s reads as the nearest state (%s)",
    (value: number, status: SloStatus) => {
      expect(SloMetricTypeUtil.getStatusFromMetricValue(value)).toBe(status);
    },
  );

  test.each([-1, 3, NaN, Infinity, -Infinity])(
    "%s is no state",
    (value: number) => {
      expect(SloMetricTypeUtil.getStatusFromMetricValue(value)).toBeNull();
    },
  );

  test("formats a posted value as the status a chart axis should show", () => {
    expect(SloMetricTypeUtil.formatStatusMetricValue(0)).toBe("Healthy");
    expect(SloMetricTypeUtil.formatStatusMetricValue(1)).toBe("At Risk");
    expect(SloMetricTypeUtil.formatStatusMetricValue(2)).toBe(
      "Budget Exhausted",
    );
  });

  test("falls back to the raw number for a tick between states, and to nothing for a non-finite one", () => {
    expect(SloMetricTypeUtil.formatStatusMetricValue(5)).toBe("5");
    expect(SloMetricTypeUtil.formatStatusMetricValue(NaN)).toBe("");
  });
});

describe("attribute keys", () => {
  test("SLO metric rows carry the bare keys monitor metrics use, never a resource. prefix", () => {
    expect(SLO_METRIC_SLO_ID_ATTRIBUTE).toBe("sloId");
    expect(SLO_METRIC_SLO_NAME_ATTRIBUTE).toBe("sloName");
    expect(SLO_METRIC_PROJECT_ID_ATTRIBUTE).toBe("projectId");
  });

  test("incident and alert metrics carry the plural, comma-joined SLO keys", () => {
    expect(SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE).toBe(
      "serviceLevelObjectiveIds",
    );
    expect(SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE).toBe(
      "serviceLevelObjectiveNames",
    );
  });
});

describe("module hygiene", () => {
  test("stays React-free and window-free, so the worker and plain node tests can load it", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Utils",
        "Slo",
        "SloMetricType.ts",
      ),
      "utf8",
    );

    const importedModules: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    for (const importedModule of importedModules) {
      expect(importedModule).not.toMatch(/react/i);
      expect(importedModule).not.toContain("/UI/");
      expect(importedModule).not.toContain("/Server/");
    }
  });
});
