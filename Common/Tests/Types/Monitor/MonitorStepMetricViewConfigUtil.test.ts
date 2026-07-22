import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import { MonitorStepType } from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricViewConfigUtil from "../../../Types/Monitor/MonitorStepMetricViewConfigUtil";

/*
 * Regression coverage for the "No options" metric dropdown bug.
 *
 * The alert-criteria "Which metric query should this alert rule check?"
 * dropdown is populated from whichever metric-shaped monitor sub-config is
 * present on the step. Before this util existed the resolution was an inline
 * OR-chain that only read metricMonitor / kubernetesMonitor / dockerMonitor /
 * proxmoxMonitor / cephMonitor — so Host, Podman, DockerSwarm and IoT monitors
 * (all of which DO carry a metricViewConfig) surfaced ZERO options even though
 * their step forms had populated real query configs.
 *
 * These tests lock in that EVERY metric-shaped key is resolved, and that the
 * variable-collection semantics (dedup, drop-empty, include formulas) match
 * what the dropdown expects.
 */

// Every monitor-step key that carries a metricViewConfig.
const METRIC_SHAPED_KEYS: Array<keyof MonitorStepType> = [
  "metricMonitor",
  "hostMonitor",
  "kubernetesMonitor",
  "dockerMonitor",
  "dockerSwarmMonitor",
  "podmanMonitor",
  "proxmoxMonitor",
  "cephMonitor",
  "iotMonitor",
];

function queryWithVariable(
  metricVariable: string,
  groupByAttributeKeys?: Array<string>,
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable,
      title: metricVariable,
      description: metricVariable,
      legend: metricVariable,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {},
      groupByAttributeKeys,
    },
  } as unknown as MetricQueryConfigData;
}

function formulaWithVariable(metricVariable: string): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable,
      title: metricVariable,
      description: metricVariable,
      legend: metricVariable,
      legendUnit: undefined,
    },
    metricFormulaData: {
      metricFormula: "a + b",
    },
  } as unknown as MetricFormulaConfigData;
}

function viewConfig(
  queryVariables: Array<string>,
  formulaVariables: Array<string> = [],
): MetricsViewConfig {
  return {
    queryConfigs: queryVariables.map((v: string) => {
      return queryWithVariable(v);
    }),
    formulaConfigs: formulaVariables.map((v: string) => {
      return formulaWithVariable(v);
    }),
  };
}

function stepDataWith(
  key: keyof MonitorStepType,
  config: MetricsViewConfig,
): MonitorStepType {
  return {
    [key]: {
      metricViewConfig: config,
    },
  } as unknown as MonitorStepType;
}

describe("MonitorStepMetricViewConfigUtil", () => {
  describe("getMetricViewConfig", () => {
    test("returns undefined for undefined step data", () => {
      expect(
        MonitorStepMetricViewConfigUtil.getMetricViewConfig(undefined),
      ).toBeUndefined();
    });

    test("returns undefined for a non-metric-shaped monitor step", () => {
      const stepData: MonitorStepType = {
        logMonitor: { someField: true },
      } as unknown as MonitorStepType;

      expect(
        MonitorStepMetricViewConfigUtil.getMetricViewConfig(stepData),
      ).toBeUndefined();
    });

    test("returns undefined when the metric sub-config has no metricViewConfig", () => {
      const stepData: MonitorStepType = {
        hostMonitor: { hostIdentifier: "h-1" },
      } as unknown as MonitorStepType;

      expect(
        MonitorStepMetricViewConfigUtil.getMetricViewConfig(stepData),
      ).toBeUndefined();
    });

    // The core of the bug: each metric-shaped key must be resolvable.
    test.each(METRIC_SHAPED_KEYS)(
      "resolves metricViewConfig from %s",
      (key: keyof MonitorStepType) => {
        const config: MetricsViewConfig = viewConfig(["a"]);
        const stepData: MonitorStepType = stepDataWith(key, config);

        expect(
          MonitorStepMetricViewConfigUtil.getMetricViewConfig(stepData),
        ).toBe(config);
      },
    );

    test("prefers metricMonitor when multiple metric configs are present", () => {
      const metricConfig: MetricsViewConfig = viewConfig(["metric"]);
      const hostConfig: MetricsViewConfig = viewConfig(["host"]);
      const stepData: MonitorStepType = {
        metricMonitor: { metricViewConfig: metricConfig },
        hostMonitor: { metricViewConfig: hostConfig },
      } as unknown as MonitorStepType;

      expect(
        MonitorStepMetricViewConfigUtil.getMetricViewConfig(stepData),
      ).toBe(metricConfig);
    });
  });

  describe("getMetricVariables", () => {
    test("returns [] for undefined step data", () => {
      expect(
        MonitorStepMetricViewConfigUtil.getMetricVariables(undefined),
      ).toEqual([]);
    });

    test("returns [] for a non-metric-shaped monitor step", () => {
      const stepData: MonitorStepType = {
        dnsMonitor: {},
      } as unknown as MonitorStepType;

      expect(
        MonitorStepMetricViewConfigUtil.getMetricVariables(stepData),
      ).toEqual([]);
    });

    /*
     * Each metric-shaped key must surface its query variables (this is
     * exactly the option list the criteria "Metric" dropdown renders).
     */
    test.each(METRIC_SHAPED_KEYS)(
      "surfaces query variables from %s",
      (key: keyof MonitorStepType) => {
        const stepData: MonitorStepType = stepDataWith(
          key,
          viewConfig(["cpu", "memory"]),
        );

        expect(
          MonitorStepMetricViewConfigUtil.getMetricVariables(stepData),
        ).toEqual(["cpu", "memory"]);
      },
    );

    test("includes formula variables after query variables", () => {
      const stepData: MonitorStepType = stepDataWith(
        "hostMonitor",
        viewConfig(["a", "b"], ["c"]),
      );

      expect(
        MonitorStepMetricViewConfigUtil.getMetricVariables(stepData),
      ).toEqual(["a", "b", "c"]);
    });

    test("removes duplicate variables while preserving first-seen order", () => {
      const stepData: MonitorStepType = stepDataWith(
        "dockerMonitor",
        viewConfig(["a", "a", "b"], ["b", "c"]),
      );

      expect(
        MonitorStepMetricViewConfigUtil.getMetricVariables(stepData),
      ).toEqual(["a", "b", "c"]);
    });

    test("drops empty and missing variables", () => {
      const stepData: MonitorStepType = stepDataWith(
        "podmanMonitor",
        viewConfig(["a", "", "b"]),
      );

      expect(
        MonitorStepMetricViewConfigUtil.getMetricVariables(stepData),
      ).toEqual(["a", "b"]);
    });

    test("returns [] when queryConfigs and formulaConfigs are empty", () => {
      const stepData: MonitorStepType = stepDataWith("iotMonitor", {
        queryConfigs: [],
        formulaConfigs: [],
      });

      expect(
        MonitorStepMetricViewConfigUtil.getMetricVariables(stepData),
      ).toEqual([]);
    });

    /*
     * Custom Metric flow: the alias is the (possibly long) metric id with
     * dashes swapped for underscores, e.g. process_cpu_utilization. The
     * dropdown must still offer it.
     */
    test("surfaces a long descriptive alias from the custom-metric flow", () => {
      const stepData: MonitorStepType = stepDataWith(
        "hostMonitor",
        viewConfig(["process_cpu_utilization"]),
      );

      expect(
        MonitorStepMetricViewConfigUtil.getMetricVariables(stepData),
      ).toEqual(["process_cpu_utilization"]);
    });
  });
});
