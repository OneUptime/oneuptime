import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Dictionary from "../../../Types/Dictionary";
import OneUptimeDate from "../../../Types/Date";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData, {
  ChartSeries,
  MetricChartType,
} from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

type BuildFullQueryConfigFunction = () => MetricQueryConfigData;

const buildFullQueryConfig: BuildFullQueryConfigFunction =
  (): MetricQueryConfigData => {
    return {
      metricAliasData: {
        metricVariable: "a",
        title: "CPU Usage",
        description: "Node CPU usage",
        legend: "cpu",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.cpu.utilization",
          attributes: {
            "host.name": "node-1",
            "is.prod": true,
            replicas: 3,
          },
          aggegationType: MetricsAggregationType.P95,
        },
        groupByAttributeKeys: ["host.name", "service.name"],
      },
      getSeries: (_data: AggregatedModel): ChartSeries => {
        return { title: "should never serialize" };
      },
      yAxisValueFormatter: (value: number): string => {
        return value.toString();
      },
      transformValue: (value: number, _dataPoint: AggregatedModel): number => {
        return value;
      },
      chartType: MetricChartType.BAR,
      color: "#6366f1",
      colorsByGroup: {
        "host.name=node-1": "#f59e0b",
        "(unset)": "#ef4444",
      },
      warningThreshold: 70,
      criticalThreshold: 90.5,
      transformAsRate: true,
      overlayWithPreviousQuery: true,
    };
  };

type BuildViewDataFunction = (input: {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
  startAndEndDate?: InBetween<Date> | null;
}) => MetricViewData;

const buildViewData: BuildViewDataFunction = (input: {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
  startAndEndDate?: InBetween<Date> | null;
}): MetricViewData => {
  return {
    queryConfigs: input.queryConfigs,
    formulaConfigs: input.formulaConfigs || [],
    startAndEndDate:
      input.startAndEndDate === undefined ? null : input.startAndEndDate,
  };
};

describe("MetricExplorerUrl", () => {
  describe("buildQueryParamsFromMetricViewData", () => {
    test("round-trips every persisted query field through the URL param", () => {
      const params: Dictionary<string> =
        MetricExplorerUrl.buildQueryParamsFromMetricViewData(
          buildViewData({ queryConfigs: [buildFullQueryConfig()] }),
        );

      const rawQueries: string | undefined =
        params[MetricExplorerUrlParam.MetricQueries];

      expect(rawQueries).toBeDefined();

      const parsed: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(rawQueries as string);

      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({
        metricName: "system.cpu.utilization",
        attributes: {
          "host.name": "node-1",
          "is.prod": true,
          replicas: 3,
        },
        aggregationType: MetricsAggregationType.P95,
        alias: {
          title: "CPU Usage",
          description: "Node CPU usage",
          legend: "cpu",
          legendUnit: "%",
        },
        groupByAttributeKeys: ["host.name", "service.name"],
        chartType: MetricChartType.BAR,
        color: "#6366f1",
        colorsByGroup: {
          "host.name=node-1": "#f59e0b",
          "(unset)": "#ef4444",
        },
        warningThreshold: 70,
        criticalThreshold: 90.5,
        transformAsRate: true,
        overlayWithPreviousQuery: true,
      });
    });

    test("never serializes runtime-injected function fields", () => {
      const params: Dictionary<string> =
        MetricExplorerUrl.buildQueryParamsFromMetricViewData(
          buildViewData({ queryConfigs: [buildFullQueryConfig()] }),
        );

      const rawQueries: string = params[
        MetricExplorerUrlParam.MetricQueries
      ] as string;

      expect(rawQueries).not.toContain("getSeries");
      expect(rawQueries).not.toContain("yAxisValueFormatter");
      expect(rawQueries).not.toContain("transformValue");
      expect(rawQueries).not.toContain("should never serialize");
    });

    test("round-trips formulas with variable and alias", () => {
      const formulaConfig: MetricFormulaConfigData = {
        metricAliasData: {
          metricVariable: "c",
          title: "Error Rate",
          description: "",
          legend: "errors",
          legendUnit: "",
        },
        metricFormulaData: {
          metricFormula: "a / b * 100",
        },
      };

      const params: Dictionary<string> =
        MetricExplorerUrl.buildQueryParamsFromMetricViewData(
          buildViewData({
            queryConfigs: [],
            formulaConfigs: [formulaConfig],
          }),
        );

      const rawFormulas: string | undefined =
        params[MetricExplorerUrlParam.MetricFormulas];

      expect(rawFormulas).toBeDefined();

      const parsed: Array<SerializedMetricFormula> =
        MetricExplorerUrl.parseMetricFormulasParam(rawFormulas as string);

      expect(parsed).toEqual([
        {
          formula: "a / b * 100",
          variable: "c",
          alias: {
            title: "Error Rate",
            legend: "errors",
          },
        },
      ]);
    });

    test("emits startTime/endTime only when both ends of the window exist", () => {
      const startTime: Date = OneUptimeDate.fromString(
        "2026-07-16T10:00:00.000Z",
      );
      const endTime: Date = OneUptimeDate.fromString(
        "2026-07-16T11:00:00.000Z",
      );

      const paramsWithWindow: Dictionary<string> =
        MetricExplorerUrl.buildQueryParamsFromMetricViewData(
          buildViewData({
            queryConfigs: [buildFullQueryConfig()],
            startAndEndDate: new InBetween(startTime, endTime),
          }),
        );

      expect(paramsWithWindow[MetricExplorerUrlParam.StartTime]).toBe(
        OneUptimeDate.toString(startTime),
      );
      expect(paramsWithWindow[MetricExplorerUrlParam.EndTime]).toBe(
        OneUptimeDate.toString(endTime),
      );

      const paramsWithoutWindow: Dictionary<string> =
        MetricExplorerUrl.buildQueryParamsFromMetricViewData(
          buildViewData({ queryConfigs: [buildFullQueryConfig()] }),
        );

      expect(
        paramsWithoutWindow[MetricExplorerUrlParam.StartTime],
      ).toBeUndefined();
      expect(
        paramsWithoutWindow[MetricExplorerUrlParam.EndTime],
      ).toBeUndefined();
    });

    test("skips empty queries and formulas entirely", () => {
      const emptyQueryConfig: MetricQueryConfigData = {
        metricAliasData: {
          metricVariable: "a",
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      };

      const emptyFormulaConfig: MetricFormulaConfigData = {
        metricAliasData: {
          metricVariable: "b",
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricFormulaData: {
          metricFormula: "   ",
        },
      };

      const params: Dictionary<string> =
        MetricExplorerUrl.buildQueryParamsFromMetricViewData(
          buildViewData({
            queryConfigs: [emptyQueryConfig],
            formulaConfigs: [emptyFormulaConfig],
          }),
        );

      expect(params[MetricExplorerUrlParam.MetricQueries]).toBeUndefined();
      expect(params[MetricExplorerUrlParam.MetricFormulas]).toBeUndefined();
      expect(Object.keys(params)).toHaveLength(0);
    });

    test("keeps a query whose only content is a display customization", () => {
      const colorOnlyConfig: MetricQueryConfigData = {
        metricQueryData: {
          filterData: {
            metricName: "",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
        color: "#6366f1",
      };

      const params: Dictionary<string> =
        MetricExplorerUrl.buildQueryParamsFromMetricViewData(
          buildViewData({ queryConfigs: [colorOnlyConfig] }),
        );

      const parsed: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(
          params[MetricExplorerUrlParam.MetricQueries] as string,
        );

      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.color).toBe("#6366f1");
    });
  });

  describe("isMeaningfulMetricQuery", () => {
    test("treats each display-only customization as meaningful", () => {
      const base: SerializedMetricQuery = { metricName: "", attributes: {} };

      expect(MetricExplorerUrl.isMeaningfulMetricQuery(base)).toBe(false);
      expect(
        MetricExplorerUrl.isMeaningfulMetricQuery({
          ...base,
          aggregationType: MetricsAggregationType.Avg,
        }),
      ).toBe(false);

      const meaningfulVariants: Array<SerializedMetricQuery> = [
        { ...base, metricName: "cpu" },
        { ...base, attributes: { "host.name": "node-1" } },
        { ...base, aggregationType: MetricsAggregationType.Sum },
        { ...base, alias: { title: "CPU" } },
        { ...base, groupByAttributeKeys: ["host.name"] },
        { ...base, chartType: MetricChartType.AREA },
        { ...base, color: "#6366f1" },
        { ...base, colorsByGroup: { "host.name=node-1": "#f59e0b" } },
        { ...base, warningThreshold: 10 },
        { ...base, criticalThreshold: 20 },
        { ...base, transformAsRate: true },
        { ...base, overlayWithPreviousQuery: true },
      ];

      for (const variant of meaningfulVariants) {
        expect(MetricExplorerUrl.isMeaningfulMetricQuery(variant)).toBe(true);
      }
    });
  });

  describe("parseMetricQueriesParam", () => {
    test("parses old-format links that carry only the original field subset", () => {
      const oldFormatParam: string = JSON.stringify([
        {
          metricName: "http.server.request.duration",
          attributes: { "service.name": "api" },
          aggregationType: "P95",
          alias: { title: "Latency" },
        },
      ]);

      expect(MetricExplorerUrl.parseMetricQueriesParam(oldFormatParam)).toEqual(
        [
          {
            metricName: "http.server.request.duration",
            attributes: { "service.name": "api" },
            aggregationType: MetricsAggregationType.P95,
            alias: { title: "Latency" },
          },
        ],
      );
    });

    test("supports flat alias keys on the query record for backward compatibility", () => {
      const flatAliasParam: string = JSON.stringify([
        {
          metricName: "cpu",
          legend: "cpu legend",
          legendUnit: "%",
        },
      ]);

      const parsed: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(flatAliasParam);

      expect(parsed[0]?.alias).toEqual({
        legend: "cpu legend",
        legendUnit: "%",
      });
    });

    test("returns [] on malformed JSON or a non-array payload", () => {
      expect(MetricExplorerUrl.parseMetricQueriesParam("{not json")).toEqual(
        [],
      );
      expect(
        MetricExplorerUrl.parseMetricQueriesParam('{"metricName":"cpu"}'),
      ).toEqual([]);
    });

    test("salvages valid entries and drops wrong-typed fields instead of throwing", () => {
      const mixedParam: string = JSON.stringify([
        null,
        "garbage",
        ["also garbage"],
        {
          metricName: "cpu",
          attributes: "not an object",
          aggregationType: "NotAnAggregation",
          chartType: "pie",
          color: 42,
          colorsByGroup: { good: "#fff", bad: 7 },
          groupByAttributeKeys: ["host.name", 3, ""],
          warningThreshold: "high",
          criticalThreshold: 90,
          transformAsRate: "yes",
          overlayWithPreviousQuery: 1,
          unknownField: "ignored",
        },
      ]);

      expect(MetricExplorerUrl.parseMetricQueriesParam(mixedParam)).toEqual([
        {
          metricName: "cpu",
          attributes: {},
          colorsByGroup: { good: "#fff" },
          groupByAttributeKeys: ["host.name"],
          criticalThreshold: 90,
        },
      ]);
    });

    test("drops non-finite threshold numbers", () => {
      // JSON5 (the parser behind JSONFunctions.parse) accepts Infinity.
      const parsed: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(
          '[{"metricName":"cpu","warningThreshold":Infinity,"criticalThreshold":80}]',
        );

      expect(parsed[0]?.warningThreshold).toBeUndefined();
      expect(parsed[0]?.criticalThreshold).toBe(80);
    });
  });

  describe("parseMetricFormulasParam", () => {
    test("skips entries without a formula and returns [] on malformed input", () => {
      expect(MetricExplorerUrl.parseMetricFormulasParam("not json")).toEqual(
        [],
      );

      const parsed: Array<SerializedMetricFormula> =
        MetricExplorerUrl.parseMetricFormulasParam(
          JSON.stringify([
            { variable: "a" },
            { formula: "a + b", variable: "c" },
          ]),
        );

      expect(parsed).toEqual([{ formula: "a + b", variable: "c" }]);
    });
  });

  describe("monitor deep-link parity", () => {
    test("round-trips exactly what MonitorCriteriaEvaluator.buildMetricExplorerDeepLink produces", () => {
      /*
       * Mirrors the construction in
       * Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts
       * (buildMetricExplorerDeepLink): a single query config from the
       * criteria context plus a breach-centered time window.
       */
      const breachTime: Date = OneUptimeDate.fromString(
        "2026-07-16T09:30:00.000Z",
      );
      const startTime: Date = OneUptimeDate.addRemoveMinutes(breachTime, -30);
      const endTime: Date = OneUptimeDate.addRemoveMinutes(breachTime, 15);

      const queryConfig: MetricQueryConfigData = {
        metricQueryData: {
          filterData: {
            metricName: "k8s.pod.cpu.usage",
            attributes: MetricExplorerUrl.sanitizeAttributes({
              "k8s.namespace.name": "prod",
              nested: { dropped: true },
            }),
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      };

      const urlParams: Dictionary<string> =
        MetricExplorerUrl.buildQueryParamsFromMetricViewData({
          queryConfigs: [queryConfig],
          formulaConfigs: [],
          startAndEndDate: new InBetween(startTime, endTime),
        });

      expect(Object.keys(urlParams).sort()).toEqual([
        "endTime",
        "metricQueries",
        "startTime",
      ]);
      expect(urlParams[MetricExplorerUrlParam.StartTime]).toBe(
        OneUptimeDate.toString(startTime),
      );
      expect(urlParams[MetricExplorerUrlParam.EndTime]).toBe(
        OneUptimeDate.toString(endTime),
      );

      // The explorer must accept the deep link's metricQueries payload.
      const parsed: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(
          urlParams[MetricExplorerUrlParam.MetricQueries] as string,
        );

      expect(parsed).toEqual([
        {
          metricName: "k8s.pod.cpu.usage",
          attributes: { "k8s.namespace.name": "prod" },
          aggregationType: MetricsAggregationType.Avg,
        },
      ]);
    });
  });
});
