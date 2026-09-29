import MonitorCriteriaMessageBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaMessageBuilder";
import CompareCriteria from "../../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import MetricAliasData from "../../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE SAMPLE, ONE DESCRIPTION.
 *
 * A metric breach is written twice, by two different code paths, and a
 * user compares them side by side:
 *
 *   - the ALERT EMAIL's "Filter Conditions Met" line, produced by
 *     CompareCriteria when the filter MATCHED, and
 *   - the monitor's EVALUATION LOG line, produced by the observation and
 *     expectation builders when the filter did NOT match.
 *
 * Only the first was migrated to MetricValueFormatter, so the same
 * 1073741824-byte sample read "1.07 GB" in the inbox and
 * "1073741824.00 By" on the monitor page — and a ratio metric read "6.00%"
 * in one and "0.06" in the other.
 *
 * These tests assert the two paths render the same quantity the same way.
 * They are deliberately about AGREEMENT rather than about either exact
 * wording: the sentences around the number differ by design, the number
 * and its unit must not.
 */

function buildInputs(input: {
  metricNativeUnit: string;
  metricName: string;
  sampleValues: Array<number>;
  criteriaFilter: CriteriaFilter;
}): {
  monitor: Monitor;
  criteriaFilter: CriteriaFilter;
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
} {
  const aliasData: MetricAliasData = {
    metricVariable: "a",
    title: input.metricName,
    description: undefined,
    legend: undefined,
    legendUnit: input.metricNativeUnit,
  };

  const queryConfig: MetricQueryConfigData = {
    metricAliasData: aliasData,
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
      },
    } as unknown as MetricQueryData,
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryConfig],
    formulaConfigs: [],
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined } as never,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past1Minute,
  };

  const aggregated: AggregatedResult = {
    data: input.sampleValues.map((v: number) => {
      return {
        timestamp: new Date(),
        value: v,
      } as AggregateModel;
    }),
  };

  return {
    monitor: new Monitor(),
    criteriaFilter: input.criteriaFilter,
    monitorStep,
    dataToProcess: {
      projectId: ObjectID.generate(),
      metricResult: [aggregated],
      metricViewConfig,
      monitorId: ObjectID.generate(),
    },
  };
}

interface AgreementCase {
  name: string;
  metricName: string;
  nativeUnit: string;
  sample: number;
  threshold: string;
  /** The rendering both paths must produce for `sample`. */
  expectedValue: string;
  /** The rendering both paths must produce for `threshold`. */
  expectedThreshold: string;
}

const CASES: Array<AgreementCase> = [
  {
    name: "bytes rescale to gigabytes",
    metricName: "k8s.pod.memory.usage",
    nativeUnit: "By",
    sample: 1073741824,
    threshold: "1000000000",
    expectedValue: "1.07 GB",
    expectedThreshold: "1 GB",
  },
  {
    name: "milliseconds rescale to seconds",
    metricName: "http.server.request.duration",
    nativeUnit: "ms",
    sample: 1500,
    threshold: "1000",
    expectedValue: "1.5 sec",
    expectedThreshold: "1 sec",
  },
  {
    name: "a fraction metric reads as a percentage",
    metricName: "system.cpu.utilization",
    nativeUnit: "1",
    sample: 0.0585,
    threshold: "0.05",
    expectedValue: "5.85%",
    expectedThreshold: "5.00%",
  },
  {
    name: "a non-fraction metric carrying '1' stays bare",
    metricName: "browser.cumulative_layout_shift",
    nativeUnit: "1",
    sample: 0.31,
    threshold: "0.25",
    expectedValue: "0.31",
    expectedThreshold: "0.25",
  },
  {
    name: "a metric with no unit keeps its exact digits",
    metricName: "http.server.request.count",
    nativeUnit: "",
    sample: 5000,
    threshold: "4900",
    expectedValue: "5000",
    expectedThreshold: "4900",
  },
];

describe("the alert email and the evaluation log describe one sample identically", () => {
  for (const testCase of CASES) {
    test(testCase.name, () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
        value: testCase.threshold,
        metricMonitorOptions: {
          metricAlias: "a",
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      };

      const inputs: ReturnType<typeof buildInputs> = buildInputs({
        metricNativeUnit: testCase.nativeUnit,
        metricName: testCase.metricName,
        sampleValues: [testCase.sample],
        criteriaFilter,
      });

      /*
       * What the alert email says — CompareCriteria's sentence, which is
       * returned verbatim as the root cause when the filter matched.
       */
      const emailLine: string = CompareCriteria.getCompareMessage({
        values: testCase.sample,
        threshold: Number(testCase.threshold),
        criteriaFilter: criteriaFilter,
        metricDisplayName: testCase.metricName,
        metricName: testCase.metricName,
        unit: testCase.nativeUnit || undefined,
      });

      // What the monitor's evaluation log says for the same sample.
      const evalLogLine: string =
        MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
          ...inputs,
          didMeetCriteria: false,
          matchMessage: null,
        });

      expect(emailLine).toContain(testCase.expectedValue);
      expect(evalLogLine).toContain(testCase.expectedValue);

      expect(emailLine).toContain(testCase.expectedThreshold);
      expect(evalLogLine).toContain(testCase.expectedThreshold);
    });
  }

  /*
   * The specific strings the drift used to produce. Asserting their
   * absence is what makes this suite fail loudly if either path is
   * reverted to its own formatter.
   */
  test("neither path emits the pre-migration renderings", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "1000000000",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "By",
      metricName: "k8s.pod.memory.usage",
      sampleValues: [1073741824],
      criteriaFilter,
    });

    const evalLogLine: string =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: false,
        matchMessage: null,
      });

    expect(evalLogLine).not.toContain("1073741824");
    expect(evalLogLine).not.toContain(" By");
  });

  /*
   * A matched filter short-circuits: the message builder returns
   * CompareCriteria's sentence untouched. Pinning this keeps the two
   * paths from being confused for one another — the agreement above is a
   * property of two DIFFERENT renderers, not of one shared call.
   */
  test("a matched filter returns the email sentence verbatim", () => {
    const criteriaFilter: CriteriaFilter = {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: "1000000000",
    };

    const inputs: ReturnType<typeof buildInputs> = buildInputs({
      metricNativeUnit: "By",
      metricName: "k8s.pod.memory.usage",
      sampleValues: [1073741824],
      criteriaFilter,
    });

    expect(
      MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
        ...inputs,
        didMeetCriteria: true,
        matchMessage: "Metric Value is 1.07 GB which is greater than 1 GB.",
      }),
    ).toBe("Metric Value is 1.07 GB which is greater than 1 GB.");
  });
});
