import { describe, expect, test } from "@jest/globals";
import {
  withoutPreviewLine,
  withPreviewLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { buildThresholdReferenceLines } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import ChartReferenceLineProps from "../../../UI/Components/Charts/Types/ReferenceLineProps";

/*
 * A Metrics monitor's chart draws the rule's value as a red line across the
 * metric it compares, so a value is picked from what the metric does. The
 * line is only drawn: it never reaches the stored queries, whose own
 * warning and critical lines (a dashboard's, a chart's Create monitor's)
 * are kept as they were.
 */

type Configs = {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
};

function query(
  variable: string,
  lines: { warningThreshold?: number; criticalThreshold?: number } = {},
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: { filterData: { metricName: `metric.${variable}` } },
    ...lines,
  };
}

function formula(
  variable: string,
  lines: { warningThreshold?: number; criticalThreshold?: number } = {},
): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricFormulaData: { metricFormula: "a / b" },
    ...lines,
  };
}

function lines(configs: Configs): Array<[string, unknown, unknown]> {
  return [...configs.queryConfigs, ...configs.formulaConfigs].map(
    (config: MetricQueryConfigData | MetricFormulaConfigData) => {
      return [
        config.metricAliasData?.metricVariable || "",
        config.warningThreshold,
        config.criticalThreshold,
      ];
    },
  );
}

describe("the rule's line on a Metrics monitor's chart", () => {
  test("is drawn on the query the rule reads: the first, when it names none", () => {
    const drawn: Configs = withPreviewLine({
      queryConfigs: [query("a"), query("b")],
      formulaConfigs: [],
      alias: undefined,
      threshold: 80,
    });

    expect(lines(drawn)).toEqual([
      ["a", undefined, 80],
      ["b", undefined, undefined],
    ]);
  });

  test("on the query or formula the rule names", () => {
    const drawn: Configs = withPreviewLine({
      queryConfigs: [query("a"), query("b")],
      formulaConfigs: [formula("c")],
      alias: "c",
      threshold: 0.5,
    });

    expect(lines(drawn)).toEqual([
      ["a", undefined, undefined],
      ["b", undefined, undefined],
      ["c", undefined, 0.5],
    ]);
  });

  test("is not drawn without a value, nor over a critical line of the query's own", () => {
    expect(
      lines(
        withPreviewLine({
          queryConfigs: [query("a")],
          formulaConfigs: [],
          alias: "a",
          threshold: undefined,
        }),
      ),
    ).toEqual([["a", undefined, undefined]]);

    expect(
      lines(
        withPreviewLine({
          queryConfigs: [query("a", { criticalThreshold: 95 })],
          formulaConfigs: [],
          alias: "a",
          threshold: 80,
        }),
      ),
    ).toEqual([["a", undefined, 95]]);
  });

  test("is not drawn twice where the query's warning line already sits", () => {
    // A metric chart's Create monitor: its warning line is the rule's value.
    expect(
      lines(
        withPreviewLine({
          queryConfigs: [query("a", { warningThreshold: 10000 })],
          formulaConfigs: [],
          alias: "a",
          threshold: 10000,
        }),
      ),
    ).toEqual([["a", 10000, undefined]]);

    // A warning line elsewhere leaves room for the rule's.
    expect(
      lines(
        withPreviewLine({
          queryConfigs: [query("a", { warningThreshold: 40 })],
          formulaConfigs: [],
          alias: "a",
          threshold: 50,
        }),
      ),
    ).toEqual([["a", 40, 50]]);
  });

  test("never reaches the stored queries: an edit of the chart hands them back as stored", () => {
    const stored: Configs = {
      queryConfigs: [query("a"), query("b", { criticalThreshold: 95 })],
      formulaConfigs: [formula("c")],
    };

    const drawn: Configs = withPreviewLine({
      ...stored,
      alias: "a",
      threshold: 80,
    });

    /*
     * The person changes the chart (a new aggregation, say) and it hands
     * back what it drew, the rule's line included.
     */
    const handedBack: Configs = withoutPreviewLine({
      changed: drawn,
      stored,
      threshold: 80,
    });

    expect(lines(handedBack)).toEqual([
      ["a", undefined, undefined],
      ["b", undefined, 95],
      ["c", undefined, undefined],
    ]);
    expect("criticalThreshold" in handedBack.queryConfigs[0]!).toBe(false);
  });

  test("a stored line at the rule's value stays a stored line", () => {
    const stored: Configs = {
      queryConfigs: [query("a", { criticalThreshold: 80 })],
      formulaConfigs: [],
    };

    expect(
      lines(
        withoutPreviewLine({
          changed: withPreviewLine({ ...stored, alias: "a", threshold: 80 }),
          stored,
          threshold: 80,
        }),
      ),
    ).toEqual([["a", undefined, 80]]);
  });

  test("without a value, nothing is taken away", () => {
    const changed: Configs = {
      queryConfigs: [query("a", { criticalThreshold: 5 })],
      formulaConfigs: [],
    };

    expect(
      withoutPreviewLine({
        changed,
        stored: { queryConfigs: [query("a")], formulaConfigs: [] },
        threshold: undefined,
      }),
    ).toEqual(changed);
  });
});

/*
 * The red line is on the chart whatever the value: a value above all the
 * metric does stretches the axis to it, on a Metrics monitor's form only.
 * Elsewhere (dashboards, the explorer) a threshold far above the data never
 * squeezes it flat.
 */
describe("the threshold lines and the chart's value axis", () => {
  test("a monitor's form stretches the axis to its warning and critical lines", () => {
    const drawn: Array<ChartReferenceLineProps> = buildThresholdReferenceLines({
      warningThreshold: 60,
      criticalThreshold: 80,
      unit: "%",
      extendsDomain: true,
    });

    expect(
      drawn.map((line: ChartReferenceLineProps) => {
        return [line.value, line.extendsDomain];
      }),
    ).toEqual([
      [60, true],
      [80, true],
    ]);
  });

  test("everywhere else the axis follows the data, as it always did", () => {
    const drawn: Array<ChartReferenceLineProps> = buildThresholdReferenceLines({
      warningThreshold: 60,
      criticalThreshold: 80,
      unit: "%",
    });

    expect(drawn).toHaveLength(2);
    for (const line of drawn) {
      expect(line).not.toHaveProperty("extendsDomain");
    }
  });
});
